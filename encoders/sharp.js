const sharp = require("sharp");

/**
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {Promise<void>}
 * @throws {Error}
 */

const sharpEncodingHandler = async (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    sharp(inputPath)
      //   .webp({ lossless : true })
      .webp({ quality: 80 })
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
