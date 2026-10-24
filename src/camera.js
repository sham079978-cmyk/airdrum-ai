/**
 * camera.js
 * ---------------------------------------------------------------------------
 * Thin, careful wrapper around getUserMedia().
 *
 *  - Requests the camera ONLY when start() is called (never on page load).
 *  - Refuses to open a second stream if one is already live (no duplicate
 *    camera streams — a real bug in many demos).
 *  - Always releases the hardware on stop() by stopping every track.
 *  - Translates the usual failure cases into friendly messages.
 */

export const CameraState = {
  IDLE: 'idle',
  REQUESTING: 'requesting',
  READY: 'ready',
  ERROR: 'error',
};

export class Camera {
  constructor(videoEl, { width = 1280, height = 720, frameRate = 30 } = {}) {
    this.video = videoEl;
    this.constraints = {
      audio: false,
      video: {
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: frameRate },
        facingMode: 'user',
      },
    };
    this.stream = null;
    this.state = CameraState.IDLE;
  }

  get isRunning() {
    return !!(this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live'));
  }

  /**
   * Open the camera and attach it to the <video>.
   * @returns {Promise<{width:number,height:number}>} actual video dimensions
   */
  async start() {
    if (this.isRunning) {
      // Already live — return the current size instead of opening a 2nd stream.
      return this._size();
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.state = CameraState.ERROR;
      throw new Error(
        'This browser has no camera API (getUserMedia). Use a recent Chrome, Edge or Firefox over http://localhost or https://.'
      );
    }

    this.state = CameraState.REQUESTING;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(this.constraints);
    } catch (err) {
      this.state = CameraState.ERROR;
      throw new Error(this._friendly(err));
    }

    this.stream = stream;
    this.video.srcObject = stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;

    await new Promise((resolve, reject) => {
      const onLoaded = () => {
        this.video.removeEventListener('loadedmetadata', onLoaded);
        resolve();
      };
      this.video.addEventListener('loadedmetadata', onLoaded);
      setTimeout(() => {
        this.video.removeEventListener('loadedmetadata', onLoaded);
        if (this.video.videoWidth) resolve();
        else reject(new Error('Camera opened but produced no video frames.'));
      }, 4000);
    });

    try {
      await this.video.play();
    } catch (err) {
      // Autoplay of a muted stream is normally allowed; if not, surface it.
      throw new Error('Could not start the video preview: ' + (err.message || err));
    }

    this.state = CameraState.READY;
    return this._size();
  }

  _size() {
    return { width: this.video.videoWidth || 1280, height: this.video.videoHeight || 720 };
  }

  /** Stop every track and detach the stream. Idempotent. */
  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try { track.stop(); } catch { /* ignore */ }
      }
    }
    this.stream = null;
    try { this.video.srcObject = null; } catch { /* ignore */ }
    this.state = CameraState.IDLE;
  }

  _friendly(err) {
    const name = err && err.name ? err.name : '';
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera permission was denied. Click the camera icon in the address bar, allow access, then press Start Camera again.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No usable camera was found on this device.';
      case 'NotReadableError':
        return 'The camera is already in use by another app (Zoom, Teams, another browser tab). Close it and try again.';
      case 'AbortError':
        return 'The camera request was aborted. Please try again.';
      default:
        return 'Could not access the camera: ' + (err && err.message ? err.message : String(err));
    }
  }
}
