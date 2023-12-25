const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const path = require("path");
const fs = require("fs");
const fsPromises = fs.promises;
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

const ffprobePath = require("@ffprobe-installer/ffprobe").path;
ffmpeg.setFfprobePath(ffprobePath);

/**
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {(progress: number) => void} onProgress
 * @returns {Promise<void>}
 * @throws {Error}
 */

const ffmpegVideoEncodingHandler = async (
  inputPath,
  outputPath,
  // onProgress
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

      // console.log("codecName: ", codec);

      const bit_rate = codec.bit_rate;
      const totalDuration = codec?.duration;

      let max_bit_rate = Math.floor(bit_rate / 2);
      let min_bit_rate = Math.floor(bit_rate / 4);

      if (inputVideoCodec === "h264") {
        outputVideoCodec = "libx264";
        console.log(inputVideoCodec);
      } else if (inputVideoCodec === "hevc") {
        outputVideoCodec = "libx265";
        console.log(inputVideoCodec);
      } else if (inputVideoCodec === "vp9") {
        outputVideoCodec = "libx265";
        console.log(inputVideoCodec);
      } else {
        outputVideoCodec = "libvpx-vp9";
        console.log(inputVideoCodec);
      }

      if (codec.tags.BPS) {
        max_bit_rate = Math.floor(codec.tags.BPS / 2);
        min_bit_rate = Math.floor(codec.tags.BPS / 4);
        outputVideoCodec = "libx265";
        outputOptions = [
          `-map 0`,
          `-b:v ${max_bit_rate}`,
          `-maxrate ${max_bit_rate}`,
          `-bufsize ${max_bit_rate}`,
          "-threads 4",
          "-preset veryfast",
        ];
      } else {
        max_bit_rate = Math.floor(bit_rate / 2);
        min_bit_rate = Math.floor(bit_rate / 4);
        outputOptions = [
          `-map 0`,
          `-b:v ${max_bit_rate}`,
          `-maxrate ${max_bit_rate}`,
          `-bufsize ${max_bit_rate}`,
          `-minrate ${min_bit_rate}`,
          "-threads 4",
          "-preset veryfast",
        ];
      }

      let audioCodec = "aac";
      ffmpeg(inputPath)
        .videoCodec(outputVideoCodec)
        .audioCodec(audioCodec)
        .outputOptions(outputOptions)
        .on("start", (commandLine) => {
          // console.log("FFmpeg command:", commandLine);
          console.log("Encoding started");
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
            const percent = (totalSeconds / totalDuration) * 100;
            console.log("Encoding progress:", percent.toFixed(2) + "%");
            // onProgress(percent.toFixed(2));
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
            // console.log(
            //   "Output video codec:",
            //   data.streams.find((stream) => stream.codec_type === "video")
            // );
            resolve();
          });
        })
        .on("error", async (err) => {
          console.error("Error during encoding:", err.message);
          await fsPromises.unlink(inputPath);
          reject(err);
        })
        .output(outputPath)
        .run();
    });
  });
};

module.exports = { ffmpegVideoEncodingHandler };
