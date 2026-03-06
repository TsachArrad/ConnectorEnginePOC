import { useState } from 'react'
import axios from 'axios'
import './Chat.css'

function Chat() {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState(null)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!prompt.trim()) return

    setLoading(true)
    setError(null)
    setResponse(null)

    try {
      const res = await axios.post('/api/chat', {
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        ...(model && { model })
      })
      setResponse(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-container">
      <h2>Generate Connector</h2>
      <p className="description">
        Describe the connector you want to create. The AI will generate a complete connector JSON with validation.
      </p>

      <form onSubmit={handleSubmit} className="chat-form">
        <div className="form-group">
          <label htmlFor="prompt">What connector do you need?</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Example: Create a Monday.com connector that fetches tasks from a board..."
            rows={6}
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="model">Model (optional)</label>
          <input
            id="model"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Leave empty for default"
            disabled={loading}
          />
        </div>

        <button type="submit" disabled={loading || !prompt.trim()} className="btn-primary">
          {loading ? 'Generating...' : 'Generate Connector'}
        </button>
      </form>

      {error && (
        <div className="error-box">
          <strong>Error:</strong> {error}
        </div>
      )}

      {response && (
        <div className="response-box">
          <h3>Generated Connector</h3>
          <div className="response-meta">
            <span>Model: {response.model}</span>
          </div>
          <pre className="json-output">{response.reply}</pre>
          <button
            onClick={() => navigator.clipboard.writeText(response.reply)}
            className="btn-secondary"
          >
            Copy to Clipboard
          </button>
        </div>
      )}
    </div>
  )
}

export default Chat
