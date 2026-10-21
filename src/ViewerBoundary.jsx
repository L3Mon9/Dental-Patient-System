import { Component } from 'react'

export default class ViewerBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return <section className="card" role="alert">
        <h3>The DICOM viewer could not start</h3>
        <p>Save your patient changes, then reload the application to load the latest viewer.</p>
        <p className="viewer-error">{this.state.error.message || 'Unable to load the imaging module.'}</p>
        <button className="secondary" onClick={() => window.location.reload()}>Reload application</button>
      </section>
    }
    return this.props.children
  }
}
