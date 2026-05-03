import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

function clearAllLocalData() {
  try {
    const keys = [
      'levytskyi_cases','levytskyi_calendar_events','levytskyi_notes',
      'levytskyi_system_notes','levytskyi_content_ideas','levytskyi_timelog'
    ];
    keys.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('App crash:', error, info);
    this.setState({ info });
  }
  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || 'Невідома помилка';
      const stack = (this.state.error?.stack || '').split('\n').slice(0, 4).join('\n');
      const componentStack = (this.state.info?.componentStack || '').split('\n').slice(0, 6).join('\n');
      return (
        <div style={{
          padding: '2rem',
          color: 'white',
          background: '#1a1a2e',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem'
        }}>
          <h2>Щось пішло не так</h2>
          <p style={{color:'#ffb4b4', textAlign:'center', fontSize:13, maxWidth:600}}>
            {msg}
          </p>
          {stack && (
            <pre style={{
              color:'#888', fontSize:10, maxWidth:'90vw',
              whiteSpace:'pre-wrap', textAlign:'left',
              background:'#0f1018', padding:'8px', borderRadius:6,
              maxHeight:'25vh', overflow:'auto', margin:0
            }}>{stack}</pre>
          )}
          {componentStack && (
            <pre style={{
              color:'#666', fontSize:10, maxWidth:'90vw',
              whiteSpace:'pre-wrap', textAlign:'left',
              background:'#0f1018', padding:'8px', borderRadius:6,
              maxHeight:'25vh', overflow:'auto', margin:0
            }}>{componentStack}</pre>
          )}
          <div style={{display:'flex', gap:10, flexWrap:'wrap', justifyContent:'center'}}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.5rem 1.5rem',
                background: '#4f8ef7',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '1rem'
              }}
            >
              Перезавантажити
            </button>
            <button
              onClick={() => {
                if (window.confirm('Очистити локальні дані? Якщо в тебе підключений Google Drive — справи відновляться при наступному вході. Якщо ні — дані буде втрачено.')) {
                  clearAllLocalData();
                  window.location.reload();
                }
              }}
              style={{
                padding: '0.5rem 1.5rem',
                background: '#e74c3c',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '1rem'
              }}
            >
              Очистити дані і перезапустити
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
