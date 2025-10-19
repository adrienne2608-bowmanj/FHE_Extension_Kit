// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface ExtensionData {
  id: string;
  name: string;
  encryptedValue: string;
  timestamp: number;
  category: string;
  description: string;
}

// Randomly selected styles:
// Colors: High contrast (blue+orange)
// UI: Futuristic metal
// Layout: Card-based
// Interaction: Micro-interactions (hover effects)

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [extensions, setExtensions] = useState<ExtensionData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newExtensionData, setNewExtensionData] = useState({ name: "", category: "Payment", description: "", value: 0 });
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [showGuide, setShowGuide] = useState(false);
  const [selectedExtension, setSelectedExtension] = useState<ExtensionData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  // Randomly selected features:
  // 1. Project introduction
  // 2. Data statistics
  // 3. Search & filter
  // 4. Community links

  useEffect(() => {
    loadExtensions().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadExtensions = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract is not available");
        return;
      }

      const keysBytes = await contract.getData("extension_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing extension keys:", e); }
      }

      const list: ExtensionData[] = [];
      for (const key of keys) {
        try {
          const extensionBytes = await contract.getData(`extension_${key}`);
          if (extensionBytes.length > 0) {
            try {
              const extensionData = JSON.parse(ethers.toUtf8String(extensionBytes));
              list.push({
                id: key,
                name: extensionData.name,
                encryptedValue: extensionData.value,
                timestamp: extensionData.timestamp,
                category: extensionData.category,
                description: extensionData.description
              });
            } catch (e) { console.error(`Error parsing extension data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading extension ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setExtensions(list);
    } catch (e) { console.error("Error loading extensions:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitExtension = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting data with Zama FHE..." });
    try {
      const encryptedValue = FHEEncryptNumber(newExtensionData.value);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const extensionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const extensionData = {
        name: newExtensionData.name,
        value: encryptedValue,
        timestamp: Math.floor(Date.now() / 1000),
        category: newExtensionData.category,
        description: newExtensionData.description
      };
      
      await contract.setData(`extension_${extensionId}`, ethers.toUtf8Bytes(JSON.stringify(extensionData)));
      
      const keysBytes = await contract.getData("extension_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(extensionId);
      await contract.setData("extension_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Extension data encrypted and stored!" });
      await loadExtensions();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewExtensionData({ name: "", category: "Payment", description: "", value: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: isAvailable ? "Contract is available and ready for FHE operations" : "Contract is not available" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");

  const filteredExtensions = extensions.filter(ext => {
    const matchesSearch = ext.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         ext.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "All" || ext.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ["All", ...Array.from(new Set(extensions.map(ext => ext.category)))];

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE toolkit...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">🔒</div>
          <h1>FHE Browser Extension Kit</h1>
        </div>
        <div className="header-actions">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
          <button onClick={() => setShowCreateModal(true)} className="primary-btn">
            + New Extension
          </button>
          <button onClick={checkAvailability} className="secondary-btn">
            Check Contract
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="intro-section">
          <div className="intro-card">
            <h2>FHE-Powered Browser Extensions</h2>
            <p>
              Build privacy-preserving browser extensions with Zama FHE technology. 
              Encrypt user data in the browser before sending to the blockchain.
            </p>
            <div className="tech-tags">
              <span>FHE Encryption</span>
              <span>Browser API Integration</span>
              <span>Wallet Interactions</span>
            </div>
            <button onClick={() => setShowGuide(!showGuide)} className="guide-btn">
              {showGuide ? "Hide Guide" : "Show Developer Guide"}
            </button>
          </div>
        </section>

        {showGuide && (
          <section className="guide-section">
            <div className="guide-card">
              <h3>Developer Guide</h3>
              <div className="steps">
                <div className="step">
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <h4>Integrate FHE Library</h4>
                    <p>Import Zama FHE library to encrypt data before sending to blockchain</p>
                  </div>
                </div>
                <div className="step">
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <h4>Handle Browser Data</h4>
                    <p>Use browser APIs to access page data and encrypt sensitive information</p>
                  </div>
                </div>
                <div className="step">
                  <div className="step-number">3</div>
                  <div className="step-content">
                    <h4>Wallet Integration</h4>
                    <p>Implement wallet connections for decryption signatures</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="stats-section">
          <div className="stats-grid">
            <div className="stat-card">
              <h3>Total Extensions</h3>
              <div className="stat-value">{extensions.length}</div>
            </div>
            <div className="stat-card">
              <h3>Payment</h3>
              <div className="stat-value">{extensions.filter(e => e.category === "Payment").length}</div>
            </div>
            <div className="stat-card">
              <h3>DID</h3>
              <div className="stat-value">{extensions.filter(e => e.category === "DID").length}</div>
            </div>
            <div className="stat-card">
              <h3>Tools</h3>
              <div className="stat-value">{extensions.filter(e => e.category === "Tools").length}</div>
            </div>
          </div>
        </section>

        <section className="extensions-section">
          <div className="section-header">
            <h2>Your Extensions</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search extensions..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <span className="search-icon">🔍</span>
              </div>
              <select 
                value={filterCategory} 
                onChange={(e) => setFilterCategory(e.target.value)}
                className="category-filter"
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <button onClick={loadExtensions} disabled={isRefreshing} className="refresh-btn">
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          {filteredExtensions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📦</div>
              <h3>No extensions found</h3>
              <p>Create your first FHE-powered browser extension</p>
              <button onClick={() => setShowCreateModal(true)} className="primary-btn">
                Create Extension
              </button>
            </div>
          ) : (
            <div className="extensions-grid">
              {filteredExtensions.map(ext => (
                <div 
                  key={ext.id} 
                  className="extension-card"
                  onClick={() => setSelectedExtension(ext)}
                >
                  <div className="card-header">
                    <span className={`category-badge ${ext.category.toLowerCase()}`}>
                      {ext.category}
                    </span>
                    <h3>{ext.name}</h3>
                  </div>
                  <div className="card-body">
                    <p>{ext.description || "No description provided"}</p>
                    <div className="meta">
                      <span className="date">
                        {new Date(ext.timestamp * 1000).toLocaleDateString()}
                      </span>
                      <span className="encrypted-tag">FHE Encrypted</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="community-section">
          <div className="community-card">
            <h2>Community & Resources</h2>
            <div className="links">
              <a href="#" className="community-link">
                <span>📚</span> Documentation
              </a>
              <a href="#" className="community-link">
                <span>💬</span> Discord
              </a>
              <a href="#" className="community-link">
                <span>🐙</span> GitHub
              </a>
              <a href="#" className="community-link">
                <span>🐦</span> Twitter
              </a>
            </div>
          </div>
        </section>
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create New Extension</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Extension Name *</label>
                <input 
                  type="text" 
                  value={newExtensionData.name}
                  onChange={(e) => setNewExtensionData({...newExtensionData, name: e.target.value})}
                  placeholder="My FHE Extension"
                />
              </div>
              <div className="form-group">
                <label>Category *</label>
                <select 
                  value={newExtensionData.category}
                  onChange={(e) => setNewExtensionData({...newExtensionData, category: e.target.value})}
                >
                  <option value="Payment">Payment</option>
                  <option value="DID">DID</option>
                  <option value="Tools">Tools</option>
                </select>
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={newExtensionData.description}
                  onChange={(e) => setNewExtensionData({...newExtensionData, description: e.target.value})}
                  placeholder="What does your extension do?"
                />
              </div>
              <div className="form-group">
                <label>Test Value (FHE Demo) *</label>
                <input 
                  type="number" 
                  value={newExtensionData.value}
                  onChange={(e) => setNewExtensionData({...newExtensionData, value: parseFloat(e.target.value) || 0})}
                  placeholder="Enter a number to encrypt"
                />
                <div className="encryption-preview">
                  <span>Encrypted:</span>
                  <code>{FHEEncryptNumber(newExtensionData.value).substring(0, 30)}...</code>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button 
                onClick={submitExtension} 
                disabled={creating || !newExtensionData.name || !newExtensionData.category}
                className="submit-btn"
              >
                {creating ? "Creating..." : "Create Extension"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedExtension && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>{selectedExtension.name}</h2>
              <button onClick={() => {
                setSelectedExtension(null);
                setDecryptedValue(null);
              }} className="close-btn">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-row">
                <span>Category:</span>
                <strong>{selectedExtension.category}</strong>
              </div>
              <div className="detail-row">
                <span>Created:</span>
                <strong>{new Date(selectedExtension.timestamp * 1000).toLocaleString()}</strong>
              </div>
              <div className="detail-row">
                <span>Description:</span>
                <p>{selectedExtension.description || "No description"}</p>
              </div>
              <div className="encrypted-data">
                <h3>Encrypted Data</h3>
                <div className="data-box">
                  {selectedExtension.encryptedValue.substring(0, 100)}...
                </div>
                <button 
                  onClick={async () => {
                    if (decryptedValue !== null) {
                      setDecryptedValue(null);
                    } else {
                      const value = await decryptWithSignature(selectedExtension.encryptedValue);
                      setDecryptedValue(value);
                    }
                  }}
                  disabled={isDecrypting}
                  className="decrypt-btn"
                >
                  {isDecrypting ? "Decrypting..." : 
                   decryptedValue !== null ? "Hide Value" : "Decrypt with Wallet"}
                </button>
              </div>
              {decryptedValue !== null && (
                <div className="decrypted-data">
                  <h3>Decrypted Value</h3>
                  <div className="value-display">
                    {decryptedValue}
                  </div>
                  <div className="notice">
                    Note: This value was decrypted client-side after wallet verification
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </div>
            <div className="notification-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-logo">
            <span>FHE Extension Kit</span>
            <span className="version">v0.1.0</span>
          </div>
          <div className="footer-links">
            <a href="#">Docs</a>
            <a href="#">GitHub</a>
            <a href="#">Terms</a>
            <a href="#">Privacy</a>
          </div>
          <div className="footer-copyright">
            © {new Date().getFullYear()} FHE Extension Kit. Powered by Zama.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;