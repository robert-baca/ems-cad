import { Component } from 'react';

// Without this, a render error anywhere below (e.g. a bad historical call
// record) unmounts the whole app to a blank screen with nothing on-screen
// explaining why — or, worse, surfaces whatever raw error text a child
// component happens to render directly.
export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="fixed inset-0 z-40 bg-gray-900 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="text-gray-300 text-sm">Something went wrong loading this.</div>
            {/* TEMPORARY — diagnosing the crash a crew member hit opening My Cases; remove once found. */}
            {this.state.error && (
              <div className="text-red-400 text-xs max-w-sm break-words font-mono">
                {this.state.error.message}
              </div>
            )}
            {this.props.onClose && (
              <button
                onClick={() => { this.setState({ hasError: false }); this.props.onClose(); }}
                className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
              >
                Close
              </button>
            )}
          </div>
        )
      );
    }
    return this.props.children;
  }
}
