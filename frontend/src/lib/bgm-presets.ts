type PresetName = "tension" | "exciting" | "calm";

interface PresetResult {
  endTime: number;
  stopAll: () => void;
}

const NOTE_FREQ: Record<string, number> = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, "C#4": 277.18, D4: 293.66, "D#4": 311.13, E4: 329.63, F4: 349.23,
  "F#4": 369.99, G4: 392.0, "G#4": 415.3, A4: 440.0, "A#4": 466.16, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0,
};

function noteFrequency(note: string): number {
  return NOTE_FREQ[note] ?? 440;
}

function scheduleNote(
  ctx: AudioContext,
  gain: GainNode,
  freq: number,
  start: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.3
): OscillatorNode {
  const osc = ctx.createOscillator();
  const noteGain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  noteGain.gain.setValueAtTime(0, start);
  noteGain.gain.linearRampToValueAtTime(volume, start + 0.02);
  noteGain.gain.setValueAtTime(volume, start + duration - 0.05);
  noteGain.gain.linearRampToValueAtTime(0, start + duration);
  osc.connect(noteGain);
  noteGain.connect(gain);
  osc.start(start);
  osc.stop(start + duration);
  return osc;
}

function tensionPreset(ctx: AudioContext, gain: GainNode, startTime: number): PresetResult {
  const bpm = 140;
  const beat = 60 / bpm;
  const bars = 4;
  const totalBeats = bars * 4;
  const endTime = startTime + totalBeats * beat;
  const oscs: OscillatorNode[] = [];

  // Drone - sawtooth low note
  const drone = ctx.createOscillator();
  const droneGain = ctx.createGain();
  drone.type = "sawtooth";
  drone.frequency.value = noteFrequency("C3");
  droneGain.gain.value = 0.08;
  drone.connect(droneGain);
  droneGain.connect(gain);
  drone.start(startTime);
  drone.stop(endTime);
  oscs.push(drone);

  // Melody - minor 2nds and tritones
  const melody = ["C4", "C#4", "C4", "F#4", "G4", "C#4", "D#4", "C4",
                   "F#4", "G4", "C#4", "C4", "D#4", "C#4", "G4", "F#4"];
  for (let i = 0; i < totalBeats; i++) {
    const note = melody[i % melody.length];
    const t = startTime + i * beat;
    oscs.push(scheduleNote(ctx, gain, noteFrequency(note), t, beat * 0.8, "square", 0.15));
  }

  return {
    endTime,
    stopAll: () => oscs.forEach((o) => { try { o.stop(); } catch {} }),
  };
}

function excitingPreset(ctx: AudioContext, gain: GainNode, startTime: number): PresetResult {
  const bpm = 160;
  const beat = 60 / bpm;
  const bars = 4;
  const totalBeats = bars * 4;
  const endTime = startTime + totalBeats * beat;
  const oscs: OscillatorNode[] = [];

  // Bass - major pentatonic root
  const bass = ["C3", "C3", "G3", "G3", "A3", "A3", "G3", "G3",
                 "F3", "F3", "E3", "E3", "D3", "D3", "C3", "C3"];
  for (let i = 0; i < totalBeats; i++) {
    const note = bass[i % bass.length];
    const t = startTime + i * beat;
    oscs.push(scheduleNote(ctx, gain, noteFrequency(note), t, beat * 0.9, "square", 0.12));
  }

  // Melody - major pentatonic
  const melody = ["C5", "D5", "E5", "G5", "A5", "G5", "E5", "D5",
                   "C5", "E5", "G5", "A5", "G5", "E5", "D5", "C5"];
  for (let i = 0; i < totalBeats; i++) {
    const note = melody[i % melody.length];
    const t = startTime + i * beat;
    oscs.push(scheduleNote(ctx, gain, noteFrequency(note), t, beat * 0.7, "triangle", 0.2));
  }

  return {
    endTime,
    stopAll: () => oscs.forEach((o) => { try { o.stop(); } catch {} }),
  };
}

function calmPreset(ctx: AudioContext, gain: GainNode, startTime: number): PresetResult {
  const bpm = 80;
  const beat = 60 / bpm;
  const bars = 4;
  const totalBeats = bars * 4;
  const endTime = startTime + totalBeats * beat;
  const oscs: OscillatorNode[] = [];

  // C major arpeggio, long notes
  const arpeggio = ["C4", "E4", "G4", "C5", "G4", "E4", "C4", "G3",
                     "A3", "C4", "E4", "A4", "E4", "C4", "G3", "C4"];
  const noteDur = beat * 1.8;
  for (let i = 0; i < totalBeats; i++) {
    const note = arpeggio[i % arpeggio.length];
    const t = startTime + i * beat;
    // Sine wave with longer ADSR
    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = noteFrequency(note);
    noteGain.gain.setValueAtTime(0, t);
    noteGain.gain.linearRampToValueAtTime(0.2, t + 0.1); // Attack
    noteGain.gain.setValueAtTime(0.15, t + 0.2); // Decay → Sustain
    noteGain.gain.linearRampToValueAtTime(0, t + noteDur); // Release
    osc.connect(noteGain);
    noteGain.connect(gain);
    osc.start(t);
    osc.stop(t + noteDur + 0.01);
    oscs.push(osc);
  }

  return {
    endTime,
    stopAll: () => oscs.forEach((o) => { try { o.stop(); } catch {} }),
  };
}

const PRESETS: Record<PresetName, (ctx: AudioContext, gain: GainNode, startTime: number) => PresetResult> = {
  tension: tensionPreset,
  exciting: excitingPreset,
  calm: calmPreset,
};

export type { PresetName, PresetResult };
export { PRESETS };
