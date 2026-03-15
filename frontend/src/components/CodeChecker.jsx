import { useState } from 'react'
import axios from 'axios'
import './CodeChecker.css'

function CodeChecker() {
  const [connectorJson, setConnectorJson] = useState('')
  const [model, setModel] = useState('')
  const [enableSearch, setEnableSearch] = useState(false)
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState(null)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!connectorJson.trim()) return

    setLoading(true)
    setError(null)
    setResponse(null)

    try {
      const res = await axios.post('/api/check-code', {
        connector_json: connectorJson,
        ...(model && { model }),
        enable_internet_search: enableSearch
      })
      setResponse(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="code-checker-container">
      <h2>Code Checker</h2>
      <p className="description">
        Paste your connector JSON to validate and improve it. The AI will check for errors, 
        suggest fixes, and return an improved version while maintaining the JSON structure.
      </p>

      <form onSubmit={handleSubmit} className="code-checker-form">
        <div className="form-group">
          <label htmlFor="connectorJson">Connector JSON</label>
          <textarea
            id="connectorJson"
            value={connectorJson}
            onChange={(e) => setConnectorJson(e.target.value)}
            placeholder="Paste your connector JSON here..."
            rows={15}
            disabled={loading}
            className="json-textarea"
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

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={enableSearch}
              onChange={(e) => setEnableSearch(e.target.checked)}
              disabled={loading}
            />
            <span>Enable internet search for real-time API validation</span>
          </label>
        </div>

        <button type="submit" disabled={loading || !connectorJson.trim()} className="btn-primary">
          {loading ? 'Checking...' : 'Check & Improve Code'}
        </button>
      </form>

      {error && (
        <div className="error-box">
          <strong>Error:</strong> {error}
        </div>
      )}

      {response && (
        <div className="response-box">
          <h3>Validation Results</h3>
          
          <div className="validation-status">
            <div className={`status-badge ${response.original_valid ? 'valid' : 'invalid'}`}>
              {response.original_valid ? '✓ Original Valid' : '✗ Original Invalid'}
            </div>
            {response.validation_errors && response.validation_errors.length > 0 && (
              <div className="validation-errors">
                <h4>Validation Errors:</h4>
                <ul>
                  {response.validation_errors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {response.changes_made && response.changes_made.length > 0 && (
            <div className="changes-section">
              <h4>Changes Made:</h4>
              <ul>
                {response.changes_made.map((change, idx) => (
                  <li key={idx}>{change}</li>
                ))}
              </ul>
            </div>
          )}

          {response.recommendations && response.recommendations.length > 0 && (
            <div className="recommendations-section">
              <h4>Recommendations:</h4>
              <ul>
                {response.recommendations.map((rec, idx) => (
                  <li key={idx}>{rec}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="improved-json-section">
            <h4>Improved Connector JSON:</h4>
            <pre className="json-output">{response.improved_json}</pre>
            <button
              onClick={() => navigator.clipboard.writeText(response.improved_json)}
              className="btn-secondary"
            >
              Copy Improved JSON
            </button>
          </div>

          <div className="response-meta">
            <span>Model: {response.model}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default CodeChecker
