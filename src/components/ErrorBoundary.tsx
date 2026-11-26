import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Ein unerwarteter Fehler ist aufgetreten.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[Dinosaur Survival ErrorBoundary]', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: '#0e0d0c',
            color: '#f5efe6',
          }}
        >
          <div
            style={{
              maxWidth: '400px',
              width: '100%',
              padding: '20px',
              borderRadius: '14px',
              background: '#1f1c19',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '18px', color: '#fde68a' }}>
              Lager-Ansicht neu laden
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#c9bfb2', lineHeight: 1.45 }}>
              In der Oberfläche ist ein Fehler aufgetreten. Dein Spielstand bleibt gespeichert.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => window.location.reload()}
            >
              Neu laden
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
