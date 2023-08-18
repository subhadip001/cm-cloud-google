const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

const ffprobePath = require("@ffprobe-installer/ffprobe").path;
ffmpeg.setFfprobePath(ffprobePath);

const ffmpegVideoEncodingHandler = async (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-deadline realtime", "-threads 4"])
      .on("start", (commandLine) => {
        console.log("FFmpeg command:", commandLine);
      })
      .on("stderr", (stderrLine) => {
        const progressLine = stderrLine.trim();
        const matches = progressLine.match(/time=(\d+:\d+:\d+\.\d+)/);
        if (matches && matches.length > 1) {
          const timestamp = matches[1];
          const [hours, minutes, seconds] = timestamp
            .split(":")
            .map(parseFloat);
          const totalSeconds = hours * 3600 + minutes * 60 + seconds;
          const totalDuration = 100;
          const percent = (totalSeconds / totalDuration) * 100;
          console.log("Encoding progress:", percent.toFixed(2) + "s");
        }
      })
      .on("end", () => {
        console.log("Encoding complete");

        ffmpeg.ffprobe(outputPath, (err, data) => {
          if (err) {
            console.error("Error during ffprobe:", err.message);
            reject(err);
            return;
          }
          console.log(
            "Output video codec:",
            data.streams.find((stream) => stream.codec_type === "video")
          );
          console.log(
            "Output audio codec:",
            data.streams.find((stream) => stream.codec_type === "audio")
          );
          resolve();
        });
      })
      .on("error", (err) => {
        console.error("Error during encoding:", err.message);
        reject(err);
      })
      .output(outputPath)
      .run();
  });
};

module.exports = { ffmpegVideoEncodingHandler };
