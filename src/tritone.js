(() => {
	// TriTone music format by CarpetBakery

	// Music
	const masterVolumeMax = 1.0;
	const masterVolumeMin = 0.0;

	const rampFrames = 150;
	let sampleRate = 44100;
	const bytesPerSample = 4; // sizeof(float)
	const deviceChannels = 2;
	const requestedBufferSize = 2048;

	// Pitching
	const baseFreq = 440.0;
	const twelveRoot2 = Math.pow(2.0, 1.0 / 12.0);
	const pitchOffset = -32;

	// Tritone format
	const magicHeader = "TRTN";
	const version = 1;
	const trackCount = 16;
	const numEventTypes = 2;
	const defaultSampleData = "DUMMY";	
	
	// -- Helpers --
	function approach(from, target, amt) {
		return from < target
			? Math.min(from + amt, target)
			: Math.max(from - amt, target);
	}

	function lerp(a, b, fac) {
		return a + (b - a) * fac;
	}

	function readString(view, p) {
		throw "Not implemented.";	
	}

	class NoteEvent {
		/**
		 *
		 * @param {Number} pitch
		 * @param {Number} length
		 */
		constructor(pitch, length) {
			this.pitch = pitch;
			this.length = length;
		}
	}

	class Event {
		/**
		 *
		 * @param {Number} value
		 */
		constructor(value) {
			this.value = value;
		}
	}

	class SampleData {
		constructor() {
			this.data = new Float32Array();
		}

		freeData() {
			this.data = null;
		}

		setData(data) {
			this.freeData();
			this.data = data;
		}

		sizeBytes() {
			return this.data.byteLength;
		}

		size() {
			return this.data.length;
		}

		getSafe(index) {
			// if (data == null || this.data.length == 0) {
			//     return 0.0;
			// }

			while (index < 0) {
				index += this.data.length;
			}
			while (index >= this.data.length) {
				index -= this.data.length;
			}
			return data[Math.floor(index)];
		}
	}

	class Voice {
		constructor(sampleData) {
			this.sampleData = sampleData;

			this.dataIndex = 0.0;
			this.pitch = 0;

			this.targetVelocity = 0.85;
			this.targetPan = 0.5;
			this.rampFramesLeft = 0;

			this.velocity = this.targetVelocity;
			this.pan = this.targetPan;

			this.oneshot = false;
			this.framesLeft = 0;

			this.attackFrames = 100;
			this.attackFramesLeft = this.attackFrames;
			this.releaseActive = false;
			this.releaseFrames = 150;
		}

		setSampleData(sampleData) {
			this.sampleData = sampleData;
			this.dataIndex = 0;
		}

		eval(rightChannel) {
			if (!this.sampleData) {
				return 0.0;
			}

			let sample = evalLagrange();
			let velocityValue, panValue;

			if (this.rampFramesLeft) {
				let lerpFac = 1.0 - this.rampFramesLeft / rampFrames;

				velocityValue = lerp(
					this.velocity,
					this.targetVelocity,
					lerpFac,
				);
				panValue = lerp(this.pan, this.targetPan, lerpFac);
			} else {
				this.velocity = this.targetVelocity;
				this.pan = this.targetPan;

				velocityValue = this.velocity;
				panValue = this.pan;
			}

			// Apply velocity
			sample *= velocityValue;

			// Apply panning
			if (rightChannel) {
				let right = panValue < 0.5 ? panValue / 0.5 : 1.0;
				sample *= right;
			} else {
				let left = panValue > 0.5 ? 0.5 - (panValue - 0.5) / 0.5 : 1.0;
				sample *= Math.max(left, 0.0);
			}

			// Apply attack
			if (this.attackFramesLeft > 0) {
				let attackFac = 1.0 - m_attackFramesLeft / m_attackFrames;
				console.assert(
					attackFac <= 1.0,
					"Attack factor should not be above 1.",
				);
				sample *= attackFac;
			}

			// Apply release
			if (m_releaseActive) {
				// Ramp volume towards 0
				let releaseFac = m_framesLeft / m_releaseFrames;
				console.assert(
					releaseFac <= 1.0,
					"Release factor should not be above 1.",
				);
				sample *= releaseFac;
			}

			return sample;
		}

		evalLagrange() {
			let sample;

			let sampleA, sampleB, sampleC, sampleD;
			let c0, c1, c2, c3;
			let margin = m_dataIndex - 2;
			let subPos = m_dataIndex - static_cast < int > m_dataIndex;

			sampleA = this.sampleData.getSafe(margin - 1);
			sampleB = this.sampleData.getSafe(margin);
			sampleC = this.sampleData.getSafe(margin + 1);
			sampleD = this.sampleData.getSafe(margin + 2);

			c0 = sampleB;
			c1 =
				sampleC -
				(1 / 3.0) * sampleA -
				(1 / 2.0) * sampleB -
				(1 / 6.0) * sampleD;
			c2 = (1 / 2.0) * (sampleA + sampleC) - sampleB;
			c3 =
				(1 / 6.0) * (sampleD - sampleA) +
				(1 / 2.0) * (sampleB - sampleC);

			sample = ((c3 * subPos + c2) * subPos + c1) * subPos + c0;

			return sample;
		}

		nextFrame() {
			this.incDataIndex();
			this.rampFramesLeft = approach(this.rampFramesLeft, 0, 1);
			this.attackFramesLeft = approach(this.attackFramesLeft, 0, 1);
			this.framesLeft = approach(this.framesLeft, 0, 1);
		}

		incDataIndex() {
			// Increment data index, wrap around
			let inc = Math.pow(twelveRoot2, this.pitch);
			this.dataIndex += inc;
			while (this.dataIndex > this.sampleData.size()) {
				if (this.oneshot) {
					this.framesLeft = 0;
					this.releaseActive = true;
					this.dataIndex = 0;
					return;
				}
				this.dataIndex -= this.sampleData.size();
			}
		}

		getVelocity() {
			return this.velocity;
		}
		setVelocity(velocity) {
			this.velocity = velocity;
		}
		getPan() {
			return this.pan;
		}
		setPan(pan) {
			this.pan = pan;
		}

		setPitch(pitch) {
			this.pitch = pitch + pitchOffset;
		}

		changePitch(amount = 1) {
			this.pitch += amount;
		}
	}

	class InstrumentTrack {
		constructor() {
			this.noteEvents = new Map(); // Position to list of notes
			this.velocityEvents = new Map(); // Position to event
			this.panEvents = new Map(); // Position to event

			this.sampleData = new SampleData();

			this.oneshot = false;

			// List of voices that this track is using
			this.voices = [];
		}

		/**
		 *
		 * @param {Event} event
		 * @param {Tritone} playback
		 */
		startNote(event, playback) {
			let voice = playback.requestUnusedVoice();

			if (!voice) {
				// Couldn't start the note
				return;
			}

			// Setup voice
			voice.setPitch(event.pitch);
			voice.framesLeft = event.length * playback.framesPerBeat;
			voice.oneshot = this.oneshot;

			voice.setSampleData(this.sampleData);
			this.voices.push(voice);
		}

		/**
		 *
		 * @param {Event} event
		 */
		setVelocity(event) {
			for (let i = 0; i < this.voices.length; i++) {
				this.voices[i].setVelocity(event.value);
			}
		}

		/**
		 *
		 * @param {Event} event
		 */
		setPan(event) {
			for (let i = 0; i < this.voices.length; i++) {
				this.voices[i].setPan(event.value);
			}
		}

		/**
		 *
		 * @param {Number} position
		 * @param {Tritone} playback
		 */
		triggerEvents(position, playback) {
			// Look for events at this position and apply them
			if (this.noteEvents.has(position)) {
				this.noteEvents.get(position).array.forEach((note) => {
					this.startNote(note, playback);
				});
			}

			// Get events at this song position
			if (this.velocityEvents.has(position)) {
				this.setVelocity(this.velocityEvents.get(position));
			}

			if (this.panEvents.has(position)) {
				this.setPan(this.panEvents.get(position));
			}
		}

		removeUnusedVoices() {
			let len = this.voices.length;
			for (let j = len - 1; j >= 0; j--) {
				if (this.voices.get(j).framesLeft <= 0) {
					this.voice.splice(j, 1);
				}
			}
		}

		// Delete all events from this track
		clearEvents() {
			this.noteEvents.clear();
			this.velocityEvents.clear();
			this.panEvents.clear();
		}
	}

	class Song {
		/**
		 * @param {ArrayBuffer} data
		 */
		constructor(data) {
			const view = new DataView(data);

			// TODO: Load song here

			this.endPosition = 0;
			this.bpm = 140;
			this.trackCount = 16;
			this.tracks = [];
			this.sampleDataList = [];
		}

		clearTracks() {
			for (let i = 0; i < this.trackCount; i++) {
				// this.tracks[i] =
			}
		}
	}

	class Tritone {
		constructor() {
			this.samplesPerBeat = 0;
			this.framesPerBeat = 0;
			this.beatProgress = 0;

			this.voiceCount = 128;
            this.voices = new Array<Voice>(this.voiceCount);

			// List of references to voices that aren't in use
			this.inactiveVoices = [];
			this.activeVoices = [];

			// this.bufferSizeElements = 0;
			// this.bufferSizeBytes = 0;
			// this.buffer = 0;

			// The song we currently have loaded
			this.fileLoaded = "";

            // Original threadsafe stuff
			this.playing = false;
            this.masterVolume = 0.25;
            this.playhead = 0;

            // Public
            this.song = null;
            this.samples = new Map(); // Path to SampleData

            this.samplePath = "";

			// Webaudio
			this.ctx = null;
			this.node = null;
		}

		requestUnusedVoice() {
			if (this.inactiveVoices.length <= 0) {
				// sorry bro
				return null;
			}

			let voice = this.inactiveVoices.pop()
			this.activeVoices.push(voice);

			// Initialize voice
			voice = new Voice();

			return voice;
		}

		triggerTrackEvents() {
			this.song.tracks.forEach((track) => {
				track.triggerEvents(this.playhead, this);
			});
		}

		killAllVoices() {
			for (let i = this.activeVoices.length - 1; i >= 0; i--) {
				let voice = this.activeVoices.at(i);
				voice.framesLeft = 0;
			}
		}

		startPlayingInternal() {}
		stopPlayingInternal() {}

        // Init audio engine
		init() {
			this.ctx = new (window.AudioContext || window.webkitAudioContext)();
			sampleRate = this.ctx.sampleRate;
			samplesThisTick = 0;

			this.node = this.ctx.createScriptProcessor(requestedBufferSize);
			this.node.onaudioprocess = (e) =>
				this.update(
					e.outputBuffer.getChannelData(0),
					e.outputBuffer.getChannelData(1),
				);
			this.node.connect(this.ctx.destination);
		}

        // Free audio engine
		free() {
			if (ctx) {
				node.disconnect();
				ctx.close();
			}
		}

        // Main callback from audio thread
		update(leftBuffer, rightBuffer) {
			this.generateSamples(leftBuffer, rightBuffer);
		}

		// Seek to a part of the song
		seek(position) {
			if (this.song.endPosition > 0 && position > (this.song.endPosition - 1)) {
				// if we reached the end, wrap around to the beginning
				this.playhead = 0;
				return;
			}
			this.playhead = position;
		}

        // Load a sample if it hasn't already been loaded and return a pointer to the SampleData
		loadOrFetchSampleData(path) {}

        // Generate samples and progress song
		generateSamples(leftBuffer, rightBuffer) {}

		// Load a song from a file
		async load(path, playOnLoad = false) {
			let noteCount = Array(trackCount).fill(0);
			let velocityCount = Array(trackCount).fill(0);
			let panCount = Array(trackCount).fill(0);
			let samplePaths = Array(trackCount).fill("");
			let oneshot = Array(trackCount).fill(false);

			// Fetch binary song data
			const res = await fetch(path);
			const data = await res.arrayBuffer();
			const view = new DataView(data);
			let p = 0;

			// Verify tritone project file
			const magic = view.getUint32(p, true); p += 4;
			if (magic != 0x5452544E) {
				throw "Invalid magic header.";
			}

			// -- Read song info --
			const version = view.getUint16(p, true); p += 2;
			const bpm = view.getUint16(p, true); p += 2;
			const repeatPosition = view.getUint32(p, true); p += 4;
			const endSongPosition = view.getUint32(p, true); p += 4;
			const _numEvents = view.getUint8(p, true); p += 1;
			const _numTracks = view.getUint16(p, true); p += 2;

			// -- Read track info chunk --
			for (let i = 0; i < _numTracks; i++) {
				// TODO: I didn't write readString yet
				let samplePath = readString(view, p);
				p += samplePath.length + 1;

				if (samplePath != defaultSampleData) {
					samplePaths[i] = samplePath;
				}
				else {
					samplePaths[i] = "";
				}

				oneshot[i] = view.getUint8(p, true); p += 1;

				const sampleLoopStart = view.getUint32(p, true); p += 4;
				const sampleLoopEnd = view.getUint32(p, true); p += 4;
				noteCount[i] = view.getUint32(p, true); p += 4;
				velocityCount[i] = view.getUint32(p, true); p += 4;
				panCount[i] = view.getUint32(p, true); p += 4;
			}

			// TODO: fix my original stupid method of writing data into editor structs first
			// and then filling playback structs after... should go straight into playback.
		}

		play() {}
		pause() {}
	}

	window.initTritone = async () => {
		if (window.Tritone) {
			return;
		}

		console.log("Initializing Tritone");

		window.Tritone = Tritone;
	};
})();
