import './TerminalPreview.css'

export function TerminalPreview() {
    return (
        <div className="terminal-preview" aria-label="Terminal preview">
            <div className="terminal-preview__header">
                <span className="terminal-preview__title">Terminal</span>
                <span className="terminal-preview__status">zsh</span>
            </div>
            <pre className="terminal-preview__body">
                <span className="terminal-preview__prompt">$</span> yarn workspace @kmmao/happy-codium typecheck{'\n'}
                <span className="terminal-preview__muted">Packages: @kmmao/happy-codium</span>{'\n'}
                Done in 1.8s
            </pre>
        </div>
    )
}
