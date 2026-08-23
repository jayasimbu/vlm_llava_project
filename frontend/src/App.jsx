import React, { useState, useEffect, useRef } from 'react';
import './styles.css';
import { supabase } from './supabaseClient';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function App() {
  const [page, setPage] = useState('landing');
  const [user, setUser] = useState(null);
  
  const [signupForm, setSignupForm] = useState({ email: '', password: '', displayName: '' });
  const [loginForm, setLoginForm] = useState({ email: '', password: '', remember: false });
  
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [profileForm, setProfileForm] = useState({ displayName: '' });
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [signupError, setSignupError] = useState('');
  
  const [question, setQuestion] = useState('');
  const [chatLog, setChatLog] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  
  const API_BASE = 'http://127.0.0.1:8000';

  // ── Helper: get a display value from invoice data (handles snake_case keys) ──
  const getField = (data, ...keys) => {
    if (!data) return null;
    for (const key of keys) {
      if (data[key] !== undefined && data[key] !== null && data[key] !== 'Not found') {
        return data[key];
      }
    }
    return null;
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUser({ email: session.user.email, display_name: session.user.user_metadata.display_name });
        setPage('dashboard');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setUser({ email: session.user.email, display_name: session.user.user_metadata.display_name });
        setPage('dashboard');
      } else {
        setUser(null);
        setPage('landing');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (page === 'dashboard' && user) {
      fetchHistory();
    }
  }, [page, user]);

  const showMessage = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 4000);
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    setSignupError('');
    if (signupForm.password.length < 6) {
      setSignupError('Password must be at least 6 characters long.');
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: signupForm.email,
      password: signupForm.password,
      options: {
        data: { display_name: signupForm.displayName }
      }
    });
    if (error) {
      showMessage(error.message);
    } else {
      showMessage('Signup successful! Check your email or you might be logged in automatically.');
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginForm.email,
      password: loginForm.password
    });
    if (error) {
      showMessage(error.message);
    } else {
      showMessage('Logged in successfully!');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    showMessage('Logged out successfully.');
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!forgotPasswordEmail) return;
    const { error } = await supabase.auth.resetPasswordForEmail(forgotPasswordEmail);
    if (error) {
      showMessage(error.message);
    } else {
      showMessage('Password reset email sent! Check your inbox.');
      setPage('landing');
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({
      data: { display_name: profileForm.displayName }
    });
    if (error) {
      showMessage(error.message);
    } else {
      showMessage('Profile updated successfully.');
      setUser({ ...user, display_name: profileForm.displayName });
      setShowSettingsModal(false);
    }
  };

  const handleDeleteInvoice = async (id) => {
    const { error } = await supabase.from('history').delete().eq('id', id);
    if (error) {
      showMessage(error.message);
    } else {
      showMessage('Invoice deleted.');
      if (selectedInvoice?.id === id) setSelectedInvoice(null);
      setHistory(history.filter(h => h.id !== id));
    }
  };

  const fetchHistory = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('history')
      .select('*')
      .eq('user_email', user.email)
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('Error fetching history:', error);
      showMessage('Failed to load history.');
    } else {
      setHistory(data);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading(true);
    setUploadProgress('Uploading image...');
    showMessage('Uploading and analyzing invoice...');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('lang', selectedLanguage);

    try {
      setUploadProgress('Extracting data with AI...');
      const response = await fetch(`${API_BASE}/extract`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Extraction failed');
      
      setUploadProgress('Processing results...');
      const cleanData = result.data;
      const fileUrl = `${API_BASE}${result.file_url}`;
      
      // Insert into Supabase
      if (user) {
        const { data: insertData, error } = await supabase.from('history').insert([{
          user_email: user.email,
          file_name: result.file_name,
          stored_file: fileUrl,
          status: 'processed',
          data: cleanData
        }]).select();
        
        if (error) {
          console.error('Failed to save to Supabase:', error);
        } else if (insertData) {
          setHistory([insertData[0], ...history]);
        }
      }

      setSelectedInvoice({
        data: cleanData,
        file_url: fileUrl,
        file_name: result.file_name,
      });
      setChatLog([]);
      showMessage(result.mock_mode ? 'Extracted with CPU OCR fallback.' : 'AI Extraction complete!');

    } catch (err) {
      showMessage(err.message);
    } finally {
      setUploading(false);
      setUploadProgress('');
      event.target.value = '';
    }
  };

  const askQuestion = async () => {
    if (!question.trim() || !selectedInvoice) return;
    
    const userQ = question;
    setQuestion('');
    setChatLog([...chatLog, { role: 'user', content: userQ }]);
    setChatLoading(true);

    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userQ,
          invoice_data: selectedInvoice.data
        })
      });
      const data = await res.json();
      setChatLog(prev => [...prev, { role: 'ai', content: data.answer }]);
    } catch (err) {
      setChatLog(prev => [...prev, { role: 'ai', content: "Sorry, I couldn't process that question." }]);
    } finally {
      setChatLoading(false);
    }
  };

  const exportToCSV = () => {
    if (!selectedInvoice?.data) return;
    
    const data = selectedInvoice.data;
    const rows = [
      ['Field', 'Value'],
      ['Vendor Name', getField(data, 'vendor_name') || 'N/A'],
      ['Invoice Number', getField(data, 'invoice_number') || 'N/A'],
      ['Invoice Date', getField(data, 'invoice_date', 'date') || 'N/A'],
      ['Invoice Time', getField(data, 'invoice_time') || 'N/A'],
      ['Subtotal', getField(data, 'subtotal') || 'N/A'],
      ['Discount', getField(data, 'discount') || 'N/A'],
      ['Tax', getField(data, 'tax', 'gst') || 'N/A'],
      ['Total Amount', getField(data, 'total_amount') || 'N/A'],
    ];

    // Add items
    const items = data.items || [];
    if (items.length > 0) {
      rows.push([]);
      rows.push(['Item Name', 'Quantity', 'Price']);
      items.forEach(item => {
        rows.push([
          item.name || 'N/A',
          item.qty || 'N/A',
          item.price || 'N/A'
        ]);
      });
    }
    
    const csvContent = rows.map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${selectedInvoice.file_name || 'invoice'}_data.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToPDF = () => {
    if (!selectedInvoice?.data) return;
    
    const data = selectedInvoice.data;
    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.text("Invoice Extraction Report", 14, 22);
    
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);
    doc.text(`File: ${selectedInvoice.file_name || 'Unknown'}`, 14, 36);
    
    const fieldData = [
      ['Vendor Name', String(getField(data, 'vendor_name') ?? 'N/A')],
      ['Invoice Number', String(getField(data, 'invoice_number') ?? 'N/A')],
      ['Invoice Date', String(getField(data, 'invoice_date', 'date') ?? 'N/A')],
      ['Invoice Time', String(getField(data, 'invoice_time') ?? 'N/A')],
      ['Subtotal', String(getField(data, 'subtotal') ?? 'N/A')],
      ['Discount', String(getField(data, 'discount') ?? 'N/A')],
      ['Tax / GST', String(getField(data, 'tax', 'gst') ?? 'N/A')],
      ['Total Amount', String(getField(data, 'total_amount') ?? 'N/A')],
    ];
    
    autoTable(doc, {
      startY: 45,
      head: [['Field', 'Extracted Value']],
      body: fieldData,
      theme: 'grid',
      headStyles: { fillColor: [239, 122, 112] },
      styles: { fontSize: 10, cellPadding: 4 },
      columnStyles: { 
        0: { fontStyle: 'bold', cellWidth: 60 },
        1: { cellWidth: 'auto' }
      }
    });

    // Add items table if available
    const items = data.items || [];
    if (items.length > 0) {
      const itemsData = items.map(item => [
        String(item.name || 'N/A'),
        String(item.qty || 'N/A'),
        String(item.price || 'N/A')
      ]);

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 15,
        head: [['Item Name', 'Quantity', 'Price']],
        body: itemsData,
        theme: 'grid',
        headStyles: { fillColor: [121, 152, 139] },
        styles: { fontSize: 10, cellPadding: 4 },
      });
    }
    
    doc.save(`${selectedInvoice.file_name || 'invoice'}_report.pdf`);
  };

  // ── Render: Extracted Fields Grid ─────────────────────────
  const renderFieldsGrid = (data) => {
    if (!data) return null;
    
    const fields = [
      { label: 'Vendor Name', value: getField(data, 'vendor_name'), icon: 'ti ti-building-store' },
      { label: 'Invoice Number', value: getField(data, 'invoice_number'), icon: 'ti ti-hash' },
      { label: 'Invoice Date', value: getField(data, 'invoice_date', 'date'), icon: 'ti ti-calendar' },
      { label: 'Invoice Time', value: getField(data, 'invoice_time'), icon: 'ti ti-clock' },
      { label: 'Subtotal', value: getField(data, 'subtotal'), icon: 'ti ti-receipt-2' },
      { label: 'Discount', value: getField(data, 'discount'), icon: 'ti ti-discount-2' },
      { label: 'Tax / GST', value: getField(data, 'tax', 'gst'), icon: 'ti ti-percentage' },
      { label: 'Total Amount', value: getField(data, 'total_amount'), icon: 'ti ti-cash' },
    ];

    return (
      <div className="extracted-fields-grid">
        {fields.map((f, i) => (
          <div key={i} className="field-tile">
            <div className="field-tile-header">
              <i className={f.icon}></i>
              <span className="field-label">{f.label}</span>
            </div>
            <div className="field-value">{f.value ?? 'N/A'}</div>
          </div>
        ))}
      </div>
    );
  };

  // ── Render: Items Table ───────────────────────────────────
  const renderItemsTable = (data) => {
    const items = data?.items || [];
    if (items.length === 0) return null;

    return (
      <div className="items-section dashboard-card">
        <div className="items-header">
          <i className="ti ti-list-details"></i>
          <h3>Line Items</h3>
          <span className="badge">{items.length}</span>
        </div>
        <div className="items-table-wrapper">
          <table className="items-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item Name</th>
                <th>Quantity</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td className="row-num">{idx + 1}</td>
                  <td className="item-name-cell">{item.name || 'N/A'}</td>
                  <td>{item.qty || 'N/A'}</td>
                  <td className="price-cell">{typeof item.price === 'number' ? `₹${item.price.toLocaleString()}` : (item.price || 'N/A')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderDashboard = () => (
    <div className="dashboard-container fade-in">
      <header className="main-header">
        <div className="header-brand">
          <div className="logo-mark"><i className="ti ti-receipt"></i></div>
          <span className="brand-text">Invoice Intelligence</span>
        </div>
        <div className="header-actions">
          <div className="profile-chip" onClick={() => {
            setProfileForm({ displayName: user.display_name });
            setShowSettingsModal(true);
          }}>
            <div className="avatar-circle">{user.display_name?.charAt(0).toUpperCase() || 'U'}</div>
            <span>{user.display_name}</span>
          </div>
          <button className="btn btn-secondary" onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <div className="dashboard-grid">
        <aside className="sidebar dashboard-card">
          <div className="sidebar-header">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', width: '100%' }}>
              <h3 style={{ margin: 0 }}>Saved Bills</h3>
              <span className="badge" style={{ background: 'var(--primary)', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.8rem' }}>{history.length}</span>
            </div>
          </div>
          <div className="history-list">
            {history.length === 0 ? (
              <div className="empty-state">No invoices yet. Upload one!</div>
            ) : (
              history.map(item => (
                <div 
                  key={item.id} 
                  className={`history-item ${selectedInvoice?.id === item.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedInvoice(item);
                    setChatLog([]);
                  }}
                >
                  <div className="item-icon"><i className="ti ti-file-invoice"></i></div>
                  <div className="item-details">
                    <span className="item-name">
                      {getField(item.data, 'vendor_name') || item.file_name || 'Unknown'}
                    </span>
                    <span className="item-date">{new Date(item.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="item-amount" style={{display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end'}}>
                    {getField(item.data, 'total_amount') ? `₹${item.data.total_amount}` : '-'}
                    <button 
                      className="delete-btn" 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteInvoice(item.id);
                      }}
                      title="Delete Invoice"
                    >
                      <i className="ti ti-trash"></i>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="main-content">
          {!selectedInvoice ? (
            <div className="upload-wrapper dashboard-card">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept="image/*"
                style={{ display: 'none' }}
              />
              <input
                type="file"
                ref={cameraInputRef}
                onChange={handleFileUpload}
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
              />

              <div className="language-selector" style={{ marginBottom: '1rem', width: '100%' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', fontWeight: 500 }}>Document Language</label>
                <select 
                  className="btn btn-secondary" 
                  style={{ width: '100%', padding: '0.8rem', borderRadius: '12px', border: '1px solid var(--stroke)', background: 'var(--bg-soft)', appearance: 'auto' }}
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  disabled={uploading}
                >
                  <option value="en">English (Default)</option>
                  <option value="hi">Hindi (हिंदी)</option>
                  <option value="ta">Tamil (தமிழ்)</option>
                  <option value="te">Telugu (తెలుగు)</option>
                  <option value="mr">Marathi (मराठी)</option>
                  <option value="fr">French (Français)</option>
                  <option value="latin">Spanish / Latin</option>
                </select>
              </div>
              
              <div className="upload-actions" style={{ display: 'flex', gap: '1rem', width: '100%' }}>
                {!uploading && (
                  <>
                    <div className="drop-zone half-zone" onClick={() => fileInputRef.current?.click()} style={{ flex: 1, padding: '2rem 1rem' }}>
                      <div className="upload-icon"><i className="ti ti-folder"></i></div>
                      <h3>Browse Files</h3>
                      <p>Upload from device</p>
                    </div>
                    
                    <div className="drop-zone half-zone camera-zone" onClick={() => cameraInputRef.current?.click()} style={{ flex: 1, padding: '2rem 1rem', background: 'var(--primary)', color: 'white', borderColor: 'var(--primary)' }}>
                      <div className="upload-icon" style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}><i className="ti ti-camera"></i></div>
                      <h3 style={{ color: 'white' }}>Take a Photo</h3>
                      <p style={{ color: 'rgba(255,255,255,0.8)' }}>Use Live Camera</p>
                    </div>
                  </>
                )}
                {uploading && (
                  <div className="drop-zone" style={{ width: '100%' }}>
                    <div className="upload-progress-wrapper">
                      <div className="upload-spinner"></div>
                      <h3>Analyzing Invoice</h3>
                      <p>{uploadProgress || 'Processing...'}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="invoice-viewer">
              {/* Header with vendor name and actions */}
              <div className="viewer-header dashboard-card">
                <div className="header-info">
                  <h2>{getField(selectedInvoice.data, 'vendor_name') || 'Invoice Details'}</h2>
                  <div className="chips">
                    <span className="chip"><i className="ti ti-hash"></i> {getField(selectedInvoice.data, 'invoice_number') || 'N/A'}</span>
                    <span className="chip"><i className="ti ti-calendar"></i> {getField(selectedInvoice.data, 'invoice_date', 'date') || 'N/A'}</span>
                    {getField(selectedInvoice.data, 'invoice_time') && (
                      <span className="chip"><i className="ti ti-clock"></i> {selectedInvoice.data.invoice_time}</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary" onClick={exportToCSV} title="Download CSV">
                    <i className="ti ti-file-spreadsheet"></i> CSV
                  </button>
                  <button className="btn btn-secondary" onClick={exportToPDF} title="Download PDF">
                    <i className="ti ti-file-pdf"></i> PDF
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setSelectedInvoice(null); setChatLog([]); }}>
                    <i className="ti ti-x"></i> Close
                  </button>
                </div>
              </div>

              {/* Key Metrics */}
              <div className="metrics-grid">
                <div className="metric-card highlight-card">
                  <span className="metric-label">Total Amount</span>
                  <span className="metric-value">
                    {getField(selectedInvoice.data, 'total_amount') 
                      ? `₹${selectedInvoice.data.total_amount}` 
                      : 'N/A'}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Tax / GST</span>
                  <span className="metric-value">
                    {getField(selectedInvoice.data, 'tax', 'gst') 
                      ? `₹${selectedInvoice.data.tax || selectedInvoice.data.gst}` 
                      : 'N/A'}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Subtotal</span>
                  <span className="metric-value">
                    {getField(selectedInvoice.data, 'subtotal') 
                      ? `₹${selectedInvoice.data.subtotal}` 
                      : 'N/A'}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Discount</span>
                  <span className="metric-value">
                    {getField(selectedInvoice.data, 'discount') 
                      ? `₹${selectedInvoice.data.discount}` 
                      : 'N/A'}
                  </span>
                </div>
              </div>

              {/* All Extracted Fields */}
              {renderFieldsGrid(selectedInvoice.data)}

              {/* Line Items Table */}
              {renderItemsTable(selectedInvoice.data)}

              {/* Split View: Image + Chat */}
              <div className="split-view">
                <div className="preview-panel dashboard-card">
                  {selectedInvoice.stored_file || selectedInvoice.file_url ? (
                    <img src={selectedInvoice.stored_file || selectedInvoice.file_url} alt="Invoice" />
                  ) : (
                    <div className="empty-state">No image available</div>
                  )}
                </div>

                <div className="chat-panel dashboard-card">
                  <div className="chat-header">
                    <i className="ti ti-messages"></i> Ask AI About This Invoice
                  </div>
                  <div className="chat-messages">
                    {chatLog.length === 0 && (
                      <div className="chat-empty">
                        <i className="ti ti-sparkles"></i>
                        <p>Ask anything about this invoice</p>
                        <div className="quick-questions">
                          {['What is the total?', 'Show items', 'What is the GST?', 'Vendor name?'].map((q, i) => (
                            <button key={i} className="quick-q-btn" onClick={() => { setQuestion(q); }}>
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {chatLog.map((msg, i) => (
                      <div key={i} className={`chat-bubble ${msg.role}`}>
                        {msg.content}
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="chat-bubble ai loading">
                        <span className="dot"></span><span className="dot"></span><span className="dot"></span>
                      </div>
                    )}
                  </div>
                  <div className="chat-input-wrapper">
                    <input 
                      type="text" 
                      placeholder="Ask a question..." 
                      value={question}
                      onChange={e => setQuestion(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && askQuestion()}
                    />
                    <button onClick={askQuestion} disabled={!question.trim()} className="send-btn">
                      <i className="ti ti-send"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-content dashboard-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)' }}>Account Settings</h3>
              <button className="btn-icon" onClick={() => setShowSettingsModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>
                <i className="ti ti-x"></i>
              </button>
            </div>
            <div className="modal-body" style={{ marginTop: '1.5rem' }}>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Email</label>
                <div style={{ padding: '0.8rem 1rem', background: 'var(--bg-soft)', borderRadius: '12px', color: 'var(--muted)' }}>
                  {user.email}
                </div>
              </div>
              <form onSubmit={handleUpdateProfile}>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text)', marginBottom: '0.5rem' }}>Display Name</label>
                  <input 
                    type="text" 
                    value={profileForm.displayName} 
                    onChange={e => setProfileForm({ displayName: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.8rem 1rem', borderRadius: '12px', border: '1px solid var(--stroke)', background: 'var(--bg)' }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowSettingsModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Changes</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="mesh-one"></div>
      <div className="mesh-two"></div>
      
      {message && <div className="toast-message slide-in">{message}</div>}

      {page === 'dashboard' ? renderDashboard() : (
        <div className="landing-shell">
          <nav className="top-nav fade-in">
            <div className="brand-mark"><i className="ti ti-bolt"></i></div>
            <div className="nav-links">
              <a href="#">Features</a>
              <a href="#">Security</a>
              {/* Header login button removed for cleaner UI */}
            </div>
          </nav>

          <main className="hero-section">
            <div className="hero-content reveal-up">
              {/* OCR Badge removed for cleaner UI */}
              <h1 className="hero-title">AI-Powered<br/>Invoice Intelligence</h1>
              <p className="hero-subtitle">
                Instantly extract structured data from receipts and invoices using advanced Vision-Language Models.
              </p>
            </div>

            <section className="auth-column reveal-up delay-1">
              <form 
                className="auth-card premium-card" 
                onSubmit={page === 'signup' ? handleSignupSubmit : page === 'forgot-password' ? handleResetPassword : handleLoginSubmit}
              >
                <div className="auth-card-header">
                  <p className="eyebrow-inline">
                    {page === 'signup' ? 'Create your account' : page === 'forgot-password' ? 'Reset Password' : 'Sign In'}
                  </p>
                  <h2>
                    {page === 'signup' ? 'Start your invoice workspace' : page === 'forgot-password' ? 'Recover your account' : 'Welcome Back'}
                  </h2>
                  <p>
                    {page === 'signup' ? 'Create a secure account to save invoice history.' : page === 'forgot-password' ? 'Enter your email to receive a password reset link.' : 'Sign in to access your invoice workspace.'}
                  </p>
                </div>

                {page === 'forgot-password' ? (
                  <>
                    <label className="auth-field">
                      <span>Email</span>
                      <input
                        type="email"
                        value={forgotPasswordEmail}
                        onChange={(e) => setForgotPasswordEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                      />
                    </label>
                    <button type="submit" className="btn btn-primary btn-block btn-glow">Send Reset Link</button>
                    <div className="auth-switch-row" style={{marginTop: '1.5rem'}}>
                      <button type="button" className="link-button strong-link" onClick={() => setPage('landing')}>← Back to Sign In</button>
                    </div>
                  </>
                ) : (
                  <>
                    {page === 'signup' && (
                      <label className="auth-field">
                        <span>Display Name</span>
                        <input
                          value={signupForm.displayName}
                          onChange={(event) => setSignupForm({ ...signupForm, displayName: event.target.value })}
                          placeholder="Your name"
                          required
                        />
                      </label>
                    )}

                    <label className="auth-field">
                      <span>Email</span>
                      <input
                        type="email"
                        value={page === 'signup' ? signupForm.email : loginForm.email}
                        onChange={(event) => {
                          if (page === 'signup') {
                            setSignupForm({ ...signupForm, email: event.target.value });
                          } else {
                            setLoginForm({ ...loginForm, email: event.target.value });
                          }
                        }}
                        placeholder="you@example.com"
                        required
                      />
                    </label>

                    <div className="auth-field">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <label htmlFor="password-input">Password</label>
                      {page === 'landing' && (
                        <button type="button" className="link-button" onClick={() => setPage('forgot-password')} style={{ fontSize: '0.85rem' }}>
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <input
                      id="password-input"
                      type="password"
                      value={page === 'signup' ? signupForm.password : loginForm.password}
                      onChange={(event) => {
                        if (page === 'signup') {
                          setSignupForm({ ...signupForm, password: event.target.value });
                        } else {
                          setLoginForm({ ...loginForm, password: event.target.value });
                        }
                      }}
                      placeholder="Your password"
                      required
                    />
                      {page === 'signup' && signupError && (
                        <div className="validation-error">{signupError}</div>
                      )}
                    </div>

                    <button type="submit" className="btn btn-primary btn-block btn-glow">
                      {page === 'signup' ? 'Create Account' : 'Sign In'}
                    </button>

                    <div className="auth-switch-row" style={{marginTop: '1.5rem'}}>
                      {page === 'signup' ? (
                        <>
                          <span>Already have an account?</span>
                          <button type="button" className="link-button strong-link" onClick={() => setPage('landing')}>Sign In</button>
                        </>
                      ) : (
                        <>
                          <span>Don't have an account?</span>
                          <button type="button" className="link-button strong-link" onClick={() => setPage('signup')}>Create Account →</button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </form>
            </section>
          </main>
        </div>
      )}
    </>
  );
}

export default App;
