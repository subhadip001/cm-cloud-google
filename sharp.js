const sharp = require("sharp");

const inputPath = "./test.png";

const outputPath = "./test_out_put.webp";

const sharpEncodingHandler = async (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    sharp(inputPath)
      //   .webp({ lossless : true })
      .webp({ quality: 70 })
      .toFile(outputPath, (error) => {
        if (error) {
          console.error("Error compressing image:", error);
          reject(error);
        } else {
          console.log("Image compression completed successfully.");
          resolve();
        }
      });
  });
};

module.exports = { sharpEncodingHandler };
