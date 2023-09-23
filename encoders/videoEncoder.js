const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

const ffprobePath = require("@ffprobe-installer/ffprobe").path;
ffmpeg.setFfprobePath(ffprobePath);

const ffmpegVideoEncodingHandler = async (
  inputPath,
  outputPath,
  fileExtension
) => {
  return new Promise((resolve, reject) => {
    let outputVideoCodec;
    let inputVideoCodec;
    let outputOptions = [];

    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) {
        console.error("Error during ffprobe:", err.message);
      }

      inputVideoCodec = data.streams.find(
        (stream) => stream.codec_type === "video"
      ).codec_name;
      const codec = data.streams.find(
        (stream) => stream.codec_type === "video"
      );

      console.log("codecName: ", codec);

      const bit_rate = codec.bit_rate;

      const max_bit_rate = Math.floor(bit_rate / 2);
      outputOptions = [
        `-b:v ${max_bit_rate}`,
        `-maxrate ${max_bit_rate}`,
        `-bufsize ${max_bit_rate}`,
        "-threads 4",
        "-crf 28",
        "-preset veryfast",
      ];

      if (inputVideoCodec === "h264" || inputVideoCodec === "h265") {
        outputVideoCodec = "libx264";
        console.log(inputVideoCodec);
      } else if (inputVideoCodec === "vp9") {
        outputVideoCodec = "libx265";
        console.log(inputVideoCodec);
      } else {
        outputVideoCodec = "libvpx-vp9";
        console.log(inputVideoCodec);
      }

      let audioCodec = "aac";
      ffmpeg(inputPath)
        .videoCodec(outputVideoCodec)
        .audioCodec(audioCodec)
        .outputOptions(outputOptions)
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
  });
};

module.exports = { ffmpegVideoEncodingHandler };
