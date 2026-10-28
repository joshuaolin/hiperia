import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary" role="alert">
          <h1>Something went wrong: {this.state.error.message}</h1>
          <button
            className="button button-primary"
            onClick={() => window.location.reload()}
            aria-label="Reload the page"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
