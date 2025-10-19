pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FHEExtensionKitFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds;
    bool public paused;

    struct Batch {
        uint256 id;
        bool active;
        uint256 totalEncryptedValue;
    }

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    mapping(uint256 => Batch) public batches;
    mapping(uint256 => DecryptionContext) public decryptionContexts;
    uint256 public currentBatchId;
    uint256 public constant BATCH_ID_NONE = type(uint256).max;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotActive();
    error InvalidBatchId();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId, uint256 totalEncryptedValue);
    event DataSubmitted(address indexed provider, uint256 indexed batchId, euint32 encryptedValue);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalValue);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        cooldownSeconds = 60; // Default cooldown
        currentBatchId = BATCH_ID_NONE;
        emit OwnershipTransferred(address(0), msg.sender);
        emit ProviderAdded(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batches[currentBatchId] = Batch({
            id: currentBatchId,
            active: true,
            totalEncryptedValue: 0
        });
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (currentBatchId == BATCH_ID_NONE) revert InvalidBatchId();
        if (!batches[currentBatchId].active) revert BatchNotActive();

        Batch storage batch = batches[currentBatchId];
        batch.active = false;
        emit BatchClosed(batch.id, batch.totalEncryptedValue);
        currentBatchId = BATCH_ID_NONE;
    }

    function submitData(euint32 encryptedValue) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (currentBatchId == BATCH_ID_NONE) revert InvalidBatchId();
        if (!batches[currentBatchId].active) revert BatchNotActive();
        _initIfNeeded(encryptedValue);

        Batch storage batch = batches[currentBatchId];
        batch.totalEncryptedValue = FHE.add(batch.totalEncryptedValue, encryptedValue);

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit DataSubmitted(msg.sender, batch.id, encryptedValue);
    }

    function requestBatchTotalDecryption() external onlyProvider whenNotPaused checkDecryptionCooldown {
        if (currentBatchId == BATCH_ID_NONE) revert InvalidBatchId();
        if (batches[currentBatchId].active) revert BatchNotActive(); // Batch must be closed

        euint32 encryptedTotalValue = FHE.asEuint32(batches[currentBatchId].totalEncryptedValue);
        _initIfNeeded(encryptedTotalValue);

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedTotalValue);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, currentBatchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay guard ensures this callback is processed only once.

        DecryptionContext memory ctx = decryptionContexts[requestId];
        uint256 batchId = ctx.batchId;

        // Security: Rebuild ciphertexts from current contract state in the exact same order
        // and re-calculate the state hash. This verifies that the contract state relevant to
        // this decryption request has not changed since the request was made.
        euint32 encryptedTotalValue = FHE.asEuint32(batches[batchId].totalEncryptedValue);
        bytes32[] memory currentCts = new bytes32[](1);
        currentCts[0] = FHE.toBytes32(encryptedTotalValue);
        bytes32 currentHash = _hashCiphertexts(currentCts);

        if (currentHash != ctx.stateHash) revert StateMismatch();

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();

        uint256 totalValue = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, totalValue);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 value) internal {
        if (!FHE.isInitialized(value)) revert NotInitialized();
    }

    function _requireInitialized(euint32 value) internal view {
        if (!FHE.isInitialized(value)) revert NotInitialized();
    }
}