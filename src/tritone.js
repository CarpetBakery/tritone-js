(() => {
	// TriTone music format by CarpetBakery

	const epsilon = 0.000001;
	
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

	function clamp(a, min, max)
	{
		if (a < min)
		{
			return min;
		}
		else if (a > max)
		{
			return max;
		}
		return a;
	}

	function lerp(a, b, fac) {
		return a + (b - a) * fac;
	}

	class FileStream {
		constructor() {
			this.view = null;
			this.path = "";
			this.p = 0;
		}

		static async load(path) {
			const res = await fetch(path);
			const data = await res.arrayBuffer();
			
			const fs = new FileStream();
			fs.view = new DataView(data);
			fs.path = path;
			
			return fs;
		}

		readUint8() {
			const val = this.view.getUint8(this.p);
			this.p += 1;
			return val;
		}

		readUint16(littleEndian = true) {
			const val = this.view.getUint16(this.p, littleEndian);
			this.p += 2;
			return val;
		}
		
		readUint32(littleEndian = true) {
			const val = this.view.getUint32(this.p, littleEndian);
			this.p += 4;
			return val;
		}

		readFloat32() {
			const val = this.view.getFloat32(this.p);
			this.p += 4;
			return val;
		}

		readInt8() {
			const val = this.view.getInt8(this.p);
			this.p += 1;
			return val;
		}

		readInt16(littleEndian = true) {
			const val = this.view.getInt16(this.p, littleEndian);
			this.p += 2;
			return val;
		}
		
		readInt32(littleEndian = true) {
			const val = this.view.getInt32(this.p, littleEndian);
			this.p += 4;
			return val;
		}

		readString() {
			let _length = 0;
			let bytes = [];

			while (this.p < this.view.byteLength) {
				const byte = this.view.getUint8(this.p, true);
				if (byte === 0) {
					this.p++;
					break;
				}
				bytes.push(byte);
				this.p++;
			}

			const decoder = new TextDecoder("utf-8");
			return decoder.decode(new Uint8Array(bytes));
		}
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
			this.data = null;
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

			return this.data.getChannelData(0)[Math.floor(index)];
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

		/**
		 * 
		 * @param {Boolean} rightChannel 
		 * @returns 
		 */
		eval(rightChannel) {
			if (!this.sampleData) {
				return 0.0;
			}

			let sample = this.evalLagrange();
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
				let attackFac = 1.0 - this.attackFramesLeft / this.attackFrames;
				console.assert(
					attackFac <= 1.0,
					"Attack factor should not be above 1.",
				);
				sample *= attackFac;
			}

			// Apply release
			if (this.releaseActive) {
				// Ramp volume towards 0
				let releaseFac = this.framesLeft / this.releaseFrames;
				console.assert(
					releaseFac <= 1.0,
					"Release factor should not be above 1.",
				);
				sample *= releaseFac;
			}

			return sample;
		}

		evalLagrange() {
			const index = Math.floor(this.dataIndex);
			const subPos = this.dataIndex - index;

			const sampleA = this.sampleData.getSafe(index - 1);
			const sampleB = this.sampleData.getSafe(index);
			const sampleC = this.sampleData.getSafe(index + 1);
			const sampleD = this.sampleData.getSafe(index + 2);

			const c0 = sampleB;
			const c1 =
				sampleC -
				(1 / 3.0) * sampleA -
				(1 / 2.0) * sampleB -
				(1 / 6.0) * sampleD;

			const c2 =
				(1 / 2.0) * (sampleA + sampleC) -
				sampleB;

			const c3 =
				(1 / 6.0) * (sampleD - sampleA) +
				(1 / 2.0) * (sampleB - sampleC);

			return ((c3 * subPos + c2) * subPos + c1) * subPos + c0;
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
			
			// Account for differing sample rates (hopefully)
			const rateRatio = this.sampleData.data.sampleRate / sampleRate;
			this.dataIndex += inc * rateRatio;

			while (this.dataIndex >= this.sampleData.size()) {
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

			this.sampleData = null;

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
				this.noteEvents.get(position).forEach((note) => {
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
				if (this.voices[j].framesLeft <= 0) {
					this.voices.splice(j, 1);
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
		 * @param {String} path
		 */
		constructor() {
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
            this.voices = Array.from({length: this.voiceCount}, () => new Voice());

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
            this.samples = new Map(); // Path -> SampleData

            this.samplePath = "./data/sample/";

			// Default sin sample data
			this.sineSampleData = new SampleData();

			// Webaudio
			this.ctx = null;
			this.node = null;

			// Fill unusedVoices
			for (let i = 0; i < this.voiceCount; i++) {
				this.inactiveVoices.push(this.voices[i]);
			}
		}

		requestUnusedVoice() {
			if (this.inactiveVoices.length <= 0) {
				// sorry bro
				return null;
			}

			let voice = this.inactiveVoices.pop()
			this.activeVoices.push(voice);

			// Initialize voice without breaking references
			let temp = new Voice();
			Object.assign(voice, temp);

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
			this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
			sampleRate = this.ctx.sampleRate;
			// samplesThisTick = 0;

			// Generate default sine wave
			{
				let dataSize = 100;
				let data = new Float32Array(dataSize);
				for (let i = 0; i < dataSize; i++)
				{
					let fac = i / (dataSize);
					fac *= Math.PI * 2.0;
					
					data[i] = Math.sin(fac) * 0.4;
				}
				let buffer = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
				buffer.copyToChannel(data, 0);
				this.sineSampleData.setData(buffer);
			}

			// Start playback
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
		async loadOrFetchSampleData(path) {
			if (this.samples.has(path)) {
				return this.samples.get(path);
			}

			console.log("Loading ", path);

			try {
				// Load the file
				const res = await fetch(this.samplePath + path);
				const arrayBuffer = await res.arrayBuffer();
				const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
	
				console.log(path, " loaded: ", audioBuffer);
	
				let sample = new SampleData();
				sample.setData(audioBuffer);
				this.samples.set(path, sample);
				return sample;
			}
			catch (error) {
				console.log("Could not read sample ", path, ". Falling back to default sin...");
				return this.sineSampleData;
			}
		}

		/*
		-- .tri file spec --

		4 char "TRTN" magic header
		u16 - version number
		u16 - tempo (BPM)
		u32 - repeat position
		u32 - end song position
		u8 	- number of event types (velocity, pan)
		u16 - number of tracks

		PER-TRACK (instrument data):
		--  Null-terminated string - sample data filename
		--  u8 	- oneshot (0 or 1)
		--  u32 - sample loop start
		--  u32 - sample loop end
		--  u32 - note event count
		--  u32 - velocity event count
		--  u32 - pan event count

		PER-TRACK (event data):
		--	PER-noteCount
		--	--	u32 - position
		--	--	u8 	- pitch
		--	--	u16 - length
		--	PER-velocityCount
		--	--	u32 	- position
		--	--	u8 - value
		--	PER-panCount
		--	--	u32 	- position
		--	--	u8 - value

		*/
		// Load a song from a file
		async load(path, playOnLoad = false) {
			let perfStart = performance.now();
			
			let song = new Song();
			
			let noteCount = Array(trackCount).fill(0);
			let velocityCount = Array(trackCount).fill(0);
			let panCount = Array(trackCount).fill(0);
			let samplePaths = Array(trackCount).fill("");
			let oneshot = Array(trackCount).fill(false);

			// Fetch binary song data
			const f = await FileStream.load(path);

			// Verify tritone project file
			const magic = ['T', 'R', 'T', 'N'];
			for (let i = 0; i < 4; i++) {
				const c = String.fromCharCode(f.readUint8());
				if (c != magic[i]) {
					throw "Invalid magic header.";
				}
			}

			// -- Read song info --
			const version = f.readUint16(true);
			song.bpm = f.readUint16(true);
			const repeatPosition = f.readUint32(true); // Unused
			song.endPosition = f.readUint32(true);
			const _numEvents = f.readUint8(true);
			song.trackCount = f.readUint16(true);

			// Calculate samples per beat
			let beatsPerSecond = song.bpm / 60.0;
			this.samplesPerBeat = sampleRate / beatsPerSecond;
			this.framesPerBeat = this.samplesPerBeat / 4.0

			// -- Read track info chunk --
			for (let i = 0; i < song.trackCount; i++) {
				let samplePath = f.readString();

				if (samplePath != defaultSampleData) {
					samplePaths[i] = samplePath;
				}
				else {
					samplePaths[i] = "";
				}

				oneshot[i] = f.readUint8(true);

				const sampleLoopStart = f.readUint32(true); // Unused
				const sampleLoopEnd = f.readUint32(true); // Unused
				noteCount[i] = f.readUint32(true);
				velocityCount[i] = f.readUint32(true);
				panCount[i] = f.readUint32(true);
			}

			// Read track event data
			for (let i = 0; i < song.trackCount; i++) {
				let track = new InstrumentTrack();
				
				let samplePath = samplePaths[i];
				let _oneshot = oneshot[i];

				// Read note data
				for (let j = 0; j < noteCount[i]; j++) {
					let note = new NoteEvent();
	
					let position = f.readUint32(true);
					note.pitch = f.readUint8(true);
					note.length = f.readUint16(true);

					// Push into noteEvents
					if (track.noteEvents.has(position)) {
						let noteList = track.noteEvents.get(position);
						noteList.push(note);
					}
					else {
						track.noteEvents.set(position, [note]);
					}
				}

				this.readEvents(f, velocityCount[i], track.velocityEvents, version);
				this.readEvents(f, panCount[i], track.panEvents, version);

				// Read sample data
				track.sampleData = await this.loadOrFetchSampleData(samplePath);

				song.tracks.push(track);
			}

			// TODO: Free sample data that isn't used in this song

			this.song = song;
			console.log("Loaded " + path, "in", (performance.now() - perfStart), "ms");

			if (playOnLoad) {
				this.play();
			}
		}

		readEvents(f, numEvents, eventMap, version) {
			if (version == 1) {
				for (let i = 0; i < numEvents; i++) {
					let event = new Event(0);
					
					let position = f.readUint32();
					event.value = f.readUint8() / 0xFF;
					
					eventMap.set(position, event);
				}
			}
			else if (version == 0) {
				for (let i = 0; i < numEvents; i++) {
					let event = new Event(0);

					let position = f.readUint32();
					event.value = f.readFloat32();

					eventMap.set(position, event);
				}
			}
		}

		play() {
			this.playing = true;
			this.seek(this.playhead);
			this.beatProgress = 0;
			this.triggerTrackEvents();
		}
		pause() {
			this.playing = false;
			this.killAllVoices();
		}

		// Generate samples and progress song
		generateSamples(leftBuffer, rightBuffer) {
			// Zero memory
			leftBuffer.fill(0);
			rightBuffer.fill(0);

			// TEMP
			// TODO: Need something to block audio thread while file is loading, otherwise tracks will be in weird state
			if (!this.playing) {
				return;
			}

			let framesLeft = leftBuffer.length;
			let p = 0;

			while (framesLeft > 0) {
				// Move to the next beat
				if (this.beatProgress >= this.framesPerBeat && this.framesPerBeat > 0) {
					while (this.beatProgress >= this.framesPerBeat) {
						this.beatProgress -= this.framesPerBeat;
					}

					this.seek(this.playhead + 1);
					this.triggerTrackEvents();
				}

				// Calculate number of frames to do
				let framesToDo = Math.min(this.framesPerBeat - this.beatProgress, framesLeft);
				framesLeft -= framesToDo;

				// Prevent deadlock in a situation where we haven't loaded a song yet
				if (framesToDo <= 0 && framesLeft > 0) {
					framesLeft -= framesLeft;
				}

				// Prevent deadlock where framesToDo becomes really small
				if (this.framesPerBeat - this.beatProgress < epsilon) {
					this.beatProgress = this.framesPerBeat;
					continue;
				}

				if (this.playing) {
					this.beatProgress += framesToDo;
				}

				// -- Generate samples --
				for (let i = 0; i < framesToDo; i++) {
					let len = this.activeVoices.length;
					for (let j = len - 1; j >= 0; j--) {
						let voice = this.activeVoices.at(j);

						// Create left/right sample
						leftBuffer[p] += voice.eval(false);
						rightBuffer[p] += voice.eval(true);

						// Update voice
						voice.nextFrame();
						if (voice.framesLeft <= 0) {
							if (!voice.releaseActive && voice.releaseFrames > 0) {
								// Activate release
								voice.releaseActive = true;
								voice.framesLeft = voice.releaseFrames;
							}
							else {
								// Make this voice unused
								this.inactiveVoices.push(voice);
								this.activeVoices.splice(j, 1);
							}
						}
					}
					p++;
				}

				this.song.tracks.forEach((track) => {
					track.removeUnusedVoices();
				})
			}

			// Do final mixing
			for (let i = 0; i < leftBuffer.length; i++) {
				// Scale to master volume
				leftBuffer[i] *= this.masterVolume;
				rightBuffer[i] *= this.masterVolume;

				// Clip at 1.0 / -1.0
				leftBuffer[i] = clamp(leftBuffer[i], -masterVolumeMax, masterVolumeMax);
				rightBuffer[i] = clamp(rightBuffer[i], -masterVolumeMax, masterVolumeMax);
			}

			// if (this.playing) {
			// 	console.log("Generated ", leftBuffer, rightBuffer, "samples");
			// }
		}
	}

	window.initTritone = async () => {
		if (window.Tritone) {
			return;
		}

		console.log("Initializing Tritone");
		window.Tritone = new Tritone();
		window.Tritone.init();
	};

	window.loadTritone = async (path, playOnLoad = false) => {
		await window.initTritone();
		await window.Tritone.load(path, playOnLoad)
	}
})();
