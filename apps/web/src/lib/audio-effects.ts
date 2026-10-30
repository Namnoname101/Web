// Web Audio API Synthesizer - No external sound files needed
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Phát tiếng chuông báo khi hết giờ Pomodoro (chime hòa âm C5 - E5 - G5 nhẹ nhàng).
 */
export function playBellSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const freqs = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.12, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 1.8);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 2.0);
    });
  } catch (err) {
    console.warn('Audio playback not supported or user has not interacted with DOM yet', err);
  }
}

/**
 * Bộ tạo âm thanh nền tự nhiên (tiếng mưa rơi thư giãn / Brown noise) để tăng độ tập trung.
 */
class AmbientSoundGenerator {
  private noiseNode: AudioNode | null = null;
  private isPlaying = false;

  startRain(): void {
    if (this.isPlaying) return;
    try {
      const ctx = getAudioContext();
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      // Brown noise synthesis (soothing gentle rain effect)
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = output[i];
        output[i] *= 2.5; // Gain adjustment
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      // Low pass filter for warm rain sound
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(700, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.04, ctx.currentTime);

      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      whiteNoise.start(0);
      this.noiseNode = whiteNoise;
      this.isPlaying = true;
    } catch (e) {
      console.warn('Cannot start ambient sound', e);
    }
  }

  stop(): void {
    if (this.noiseNode) {
      try {
        (this.noiseNode as AudioScheduledSourceNode).stop();
        this.noiseNode.disconnect();
      } catch {}
      this.noiseNode = null;
    }
    this.isPlaying = false;
  }

  toggle(): boolean {
    if (this.isPlaying) {
      this.stop();
      return false;
    } else {
      this.startRain();
      return true;
    }
  }

  active(): boolean {
    return this.isPlaying;
  }
}

export const ambientSound = new AmbientSoundGenerator();
