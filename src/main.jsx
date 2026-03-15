import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Landing from './Landing'

function Root() {
  const [entered, setEntered] = useState(false);
  return entered ? <App /> : <Landing onEnter={() => setEntered(true)} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
