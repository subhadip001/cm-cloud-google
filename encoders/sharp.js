const sharp = require("sharp");

/**
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {Promise<void>}
 * @throws {Error}
 */

const sharpEncodingHandler = async (inputPath, outputPath) => {

  const extension = outputPath.split(".").pop().toLowerCase();
  let q = 80;
  if (extension == "webp" || extension == "avif") {
    q = 50;
  }

  return new Promise((resolve, reject) => {
    sharp(inputPath)
      .webp({ quality: q })
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
