import { useState } from 'react'
import Chat from './components/Chat'
import Storage from './components/Storage'
import Validation from './components/Validation'
import RunEngine from './components/RunEngine'
import Debug from './components/Debug'
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState('chat')

  const tabs = [
    { id: 'chat', label: 'Chat' },
    { id: 'storage', label: 'Storage' },
    { id: 'validation', label: 'Validation' },
    { id: 'engine', label: 'Run Engine' },
    { id: 'debug', label: 'Debug' }
  ]

  return (
    <div className="app">
      <header className="header">
        <h1>Connector Manager</h1>
      </header>
      
      <div className="tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="content">
        {activeTab === 'chat' && <Chat />}
        {activeTab === 'storage' && <Storage />}
        {activeTab === 'validation' && <Validation />}
        {activeTab === 'engine' && <RunEngine />}
        {activeTab === 'debug' && <Debug />}
      </div>
    </div>
  )
}

export default App
