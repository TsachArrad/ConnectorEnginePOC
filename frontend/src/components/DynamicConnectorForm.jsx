import { useState } from 'react'
import './DynamicConnectorForm.css'

function DynamicConnectorForm({ onGenerate }) {
  const [connectorName, setConnectorName] = useState('')
  const [authFields, setAuthFields] = useState([])
  const [configTypes, setConfigTypes] = useState([])
  const [configValues, setConfigValues] = useState({})

  // Add a new auth field
  const addAuthField = () => {
    setAuthFields([...authFields, { key: '', value: '', type: 'string' }])
  }

  // Remove an auth field
  const removeAuthField = (index) => {
    setAuthFields(authFields.filter((_, i) => i !== index))
  }

  // Update auth field
  const updateAuthField = (index, field, value) => {
    const updated = [...authFields]
    updated[index][field] = value
    setAuthFields(updated)
  }

  // Add a new configuration type
  const addConfigType = () => {
    setConfigTypes([
      ...configTypes,
      {
        key: '',
        type: 'string',
        required: false,
        default: '',
        description: '',
        enum: []
      }
    ])
  }

  // Remove a config type
  const removeConfigType = (index) => {
    const typeToRemove = configTypes[index].key
    setConfigTypes(configTypes.filter((_, i) => i !== index))
    
    // Also remove from config values
    const updatedValues = { ...configValues }
    delete updatedValues[typeToRemove]
    setConfigValues(updatedValues)
  }

  // Update config type
  const updateConfigType = (index, field, value) => {
    const updated = [...configTypes]
    updated[index][field] = value
    setConfigTypes(updated)

    // If key changed, update configValues key
    if (field === 'key') {
      const oldKey = configTypes[index].key
      const newKey = value
      if (oldKey && newKey && oldKey !== newKey) {
        const updatedValues = { ...configValues }
        if (oldKey in updatedValues) {
          updatedValues[newKey] = updatedValues[oldKey]
          delete updatedValues[oldKey]
        }
        setConfigValues(updatedValues)
      }
    }
  }

  // Update config value
  const updateConfigValue = (key, value, type) => {
    let parsedValue = value
    
    // Parse based on type
    if (type === 'integer' || type === 'number') {
      parsedValue = value === '' ? '' : Number(value)
    } else if (type === 'boolean') {
      parsedValue = value === 'true' || value === true
    } else if (type === 'object') {
      try {
        parsedValue = value === '' ? {} : JSON.parse(value)
      } catch (e) {
        parsedValue = value // Keep as string if invalid JSON
      }
    } else if (type === 'array') {
      try {
        parsedValue = value === '' ? [] : JSON.parse(value)
      } catch (e) {
        parsedValue = value // Keep as string if invalid JSON
      }
    }
    
    setConfigValues({ ...configValues, [key]: parsedValue })
  }

  // Generate the final JSON
  const generateJSON = () => {
    // Build auth object
    const auth = {}
    authFields.forEach(field => {
      if (field.key) {
        auth[field.key] = field.value
      }
    })

    // Build configurationTypes object
    const configurationTypes = {}
    configTypes.forEach(ct => {
      if (ct.key) {
        const typeObj = { type: ct.type }
        if (ct.required) typeObj.required = ct.required
        if (ct.default !== '') typeObj.default = ct.default
        if (ct.description) typeObj.description = ct.description
        if (ct.enum && ct.enum.length > 0) typeObj.enum = ct.enum
        configurationTypes[ct.key] = typeObj
      }
    })

    // Build configuration object with actual values
    const configuration = { ...configValues }

    const finalJSON = {
      auth,
      configurationTypes,
      configuration
    }

    if (onGenerate) {
      onGenerate(finalJSON, connectorName)
    }

    return finalJSON
  }

  // Render input field based on type
  const renderConfigInput = (configType) => {
    const key = configType.key
    const value = configValues[key] !== undefined ? configValues[key] : configType.default || ''

    if (configType.enum && configType.enum.length > 0) {
      // Render dropdown for enum
      return (
        <select
          value={value}
          onChange={(e) => updateConfigValue(key, e.target.value, configType.type)}
          className="config-input"
        >
          <option value="">-- Select --</option>
          {configType.enum.map((enumVal, i) => (
            <option key={i} value={enumVal}>{enumVal}</option>
          ))}
        </select>
      )
    }

    if (configType.type === 'boolean') {
      return (
        <select
          value={String(value)}
          onChange={(e) => updateConfigValue(key, e.target.value, configType.type)}
          className="config-input"
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      )
    }

    if (configType.type === 'object' || configType.type === 'array') {
      return (
        <textarea
          value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value}
          onChange={(e) => updateConfigValue(key, e.target.value, configType.type)}
          className="config-textarea"
          placeholder={configType.type === 'object' ? '{}' : '[]'}
          rows={3}
        />
      )
    }

    // Default: text or number input
    return (
      <input
        type={configType.type === 'integer' || configType.type === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(e) => updateConfigValue(key, e.target.value, configType.type)}
        className="config-input"
        placeholder={configType.default || ''}
      />
    )
  }

  return (
    <div className="dynamic-form-container">
      <h2>Dynamic Connector Configuration</h2>
      <p className="description">
        Build your connector configuration using a dynamic form - no need to edit JSON directly!
      </p>

      {/* Connector Name */}
      <div className="section">
        <h3>Connector Name</h3>
        <input
          type="text"
          value={connectorName}
          onChange={(e) => setConnectorName(e.target.value)}
          placeholder="e.g., my-connector"
          className="connector-name-input"
        />
      </div>

      {/* Auth Section */}
      <div className="section">
        <h3>Authentication</h3>
        <button type="button" onClick={addAuthField} className="btn-add">
          + Add Auth Field
        </button>
        
        {authFields.map((field, index) => (
          <div key={index} className="field-row">
            <input
              type="text"
              value={field.key}
              onChange={(e) => updateAuthField(index, 'key', e.target.value)}
              placeholder="Field name (e.g., apiKey)"
              className="field-key"
            />
            <input
              type="text"
              value={field.value}
              onChange={(e) => updateAuthField(index, 'value', e.target.value)}
              placeholder="Value"
              className="field-value"
            />
            <button
              type="button"
              onClick={() => removeAuthField(index)}
              className="btn-remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Configuration Types Section */}
      <div className="section">
        <h3>Configuration Types (Schema)</h3>
        <button type="button" onClick={addConfigType} className="btn-add">
          + Add Configuration Field
        </button>
        
        {configTypes.map((ct, index) => (
          <div key={index} className="config-type-card">
            <div className="config-type-header">
              <input
                type="text"
                value={ct.key}
                onChange={(e) => updateConfigType(index, 'key', e.target.value)}
                placeholder="Field name"
                className="config-type-key"
              />
              <button
                type="button"
                onClick={() => removeConfigType(index)}
                className="btn-remove"
              >
                ✕
              </button>
            </div>
            
            <div className="config-type-fields">
              <div className="field-group">
                <label>Type:</label>
                <select
                  value={ct.type}
                  onChange={(e) => updateConfigType(index, 'type', e.target.value)}
                >
                  <option value="string">string</option>
                  <option value="integer">integer</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="object">object</option>
                  <option value="array">array</option>
                </select>
              </div>
              
              <div className="field-group">
                <label>
                  <input
                    type="checkbox"
                    checked={ct.required}
                    onChange={(e) => updateConfigType(index, 'required', e.target.checked)}
                  />
                  Required
                </label>
              </div>
              
              <div className="field-group">
                <label>Default:</label>
                <input
                  type="text"
                  value={ct.default}
                  onChange={(e) => updateConfigType(index, 'default', e.target.value)}
                  placeholder="Default value"
                />
              </div>
              
              <div className="field-group">
                <label>Description:</label>
                <input
                  type="text"
                  value={ct.description}
                  onChange={(e) => updateConfigType(index, 'description', e.target.value)}
                  placeholder="Field description"
                />
              </div>
              
              <div className="field-group">
                <label>Enum (comma-separated):</label>
                <input
                  type="text"
                  value={ct.enum.join(', ')}
                  onChange={(e) => {
                    const enumValues = e.target.value.split(',').map(v => v.trim()).filter(Boolean)
                    updateConfigType(index, 'enum', enumValues)
                  }}
                  placeholder="option1, option2, option3"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Configuration Values Section */}
      {configTypes.length > 0 && (
        <div className="section">
          <h3>Configuration Values</h3>
          <p className="subsection-note">Set the actual values for your configuration fields</p>
          
          {configTypes.map((ct, index) => {
            if (!ct.key) return null
            
            return (
              <div key={index} className="config-value-row">
                <label className="config-label">
                  <span className="config-label-name">
                    {ct.key}
                    {ct.required && <span className="required-asterisk">*</span>}
                  </span>
                  {ct.description && (
                    <span className="config-label-desc">{ct.description}</span>
                  )}
                </label>
                {renderConfigInput(ct)}
              </div>
            )
          })}
        </div>
      )}

      {/* Generate Button */}
      <div className="actions">
        <button
          type="button"
          onClick={generateJSON}
          className="btn-generate"
          disabled={!connectorName || authFields.length === 0 || configTypes.length === 0}
        >
          Generate & Save Connector
        </button>
      </div>
    </div>
  )
}

export default DynamicConnectorForm
