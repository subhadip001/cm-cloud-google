const path = require("path");
const fs = require("fs");
const { compress } = require("compress-pdf");

const pdfEncodingHandler = async (inputPath, outputPath) => {
  return new Promise(async (resolve, reject) => {
    const stats = await fs.promises.stat(inputPath);
    if (stats.size < 2000000) {
      //console.log("Small Pdf , no need to optimize");
      reject({ message: "Small Pdf , no need to optimize" });
      return;
    } else {
      console.log("Large Pdf , need to optimize");
    }

    const buffer = await compress(inputPath, {
      size: "50%", // output size
      quality: "80", // output quality
      compressMethod: "Flate", // compression method
      compressLevel: 9, // compression level
      binPath: path.join(__dirname, "../bin/gs"), // gs path
    });

    await fs.promises.writeFile(outputPath, buffer);
    const output_stat = await fs.promises.stat(outputPath);
    if (output_stat.size / stats.size > 1) {
      console.log("Compressed Pdf is more than original size");
      await fs.promises.unlink(outputPath);
      reject();
      return;
    } else {
      console.log("Compressed Pdf is less than original size");
      console.log("Pdf compressed successfully");
      resolve();
    }
  });
};

module.exports = { pdfEncodingHandler };
