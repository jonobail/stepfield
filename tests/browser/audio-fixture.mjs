export function wave() {
  const rate = 8000; const frames = rate * 64; const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8,4); data.write('WAVEfmt ',8); data.writeUInt32LE(16,16); data.writeUInt16LE(1,20); data.writeUInt16LE(1,22); data.writeUInt32LE(rate,24); data.writeUInt32LE(rate*2,28); data.writeUInt16LE(2,32); data.writeUInt16LE(16,34); data.write('data',36); data.writeUInt32LE(frames*2,40);
  for (let i=0;i<frames;i++) data.writeInt16LE(Math.round(Math.sin(i*440*2*Math.PI/rate)*2000),44+i*2); return data;
}

export async function installOutputMeter(page) {
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination,...args) {
      if (this instanceof DynamicsCompressorNode && destination === this.context.destination) {
        const meter = this.context.createAnalyser(); meter.fftSize = 2048; window.outputMeter = meter;
        connect.call(this,meter); connect.call(meter,destination); return meter;
      }
      return connect.call(this,destination,...args);
    };
    window.outputPeak = () => {
      if (!window.outputMeter) return 0;
      const values = new Float32Array(window.outputMeter.fftSize); window.outputMeter.getFloatTimeDomainData(values);
      return Math.max(...values.map(value => Math.abs(value)));
    };
  });
}

