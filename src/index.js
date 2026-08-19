(() => {
	let playButton = document.getElementById("play-button");
	let stopButton = document.getElementById("stop-button");

	let ctx = null;
	let node = null;
	let sampleRate = 0;
	let samplesPerTick = 0;
	let samplesThisTick = 0;
	let siner = 0;

	playButton.onclick = function () {
		play();
		console.log("Playing");
	};

	stopButton.onclick = function () {
		stop();
		console.log("Stopped");
	};

	function play() {
		ctx = new (window.AudioContext || window.webkitAudioContext)();
		sampleRate = ctx.sampleRate;
		samplesThisTick = 0;

		node = ctx.createScriptProcessor(2048);
		node.onaudioprocess = (e) =>
			processAudio(
				e.outputBuffer.getChannelData(0),
				e.outputBuffer.getChannelData(1),
			);
		node.connect(ctx.destination);
	}

	function stop() {
		if (ctx) {
			node.disconnect();
			ctx.close();
		}
	}

	function processAudio(leftBuffer, rightBuffer) {
		for (let sample = 0; sample < leftBuffer.length; sample++) {
			var s = Math.sin((siner / 100.0) * Math.PI * 2.0);

			leftBuffer[sample] = s;
			rightBuffer[sample] = s;

			siner++;
		}
	}
})();
