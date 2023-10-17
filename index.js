const { google } = require("googleapis");
const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const axios = require("axios");

const cluster = require("cluster");
const os = require("os");
const numCPUs = os.cpus().length;

const { ffmpegVideoEncodingHandler } = require("./encoders/videoEncoder");
const { sharpEncodingHandler } = require("./encoders/sharp");
const { pdfEncodingHandler } = require("./encoders/pdfEncoder");
const axiosClient = require("./axiosClient");
require("dotenv").config();

const app = express();

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  cors({
    origin: ["http://localhost:5000", "https://cloud.cyphermanager.com"],
    credentials: true,
  })
);

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const PORT = process.env.PORT

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

app.get("/test", (req, res) => {
  res.json({ message: "This is a test message" });
});

app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/photoslibrary",
      "https://www.googleapis.com/auth/photoslibrary.readonly",
      "https://www.googleapis.com/auth/photoslibrary.appendonly",
      "https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata",
    ],
    prompt: "consent",
  });
  res.redirect(url);
});

app.get("/google/redirect", async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);

  oauth2Client.setCredentials(tokens);

  const user = {
    googleId: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  };
  const token = jwt.sign(user, "my-secret-key");

  // Set the JWT token as an HTTP-only cookie
  res.cookie("access_token", token, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
  });
  const closePopupScript = `
    <script>
      window.opener.postMessage('authSuccess', '*');
      window.close(); 
    </script>
  `;

  res.send(closePopupScript);
});

app.get("/checkAuth", (req, res) => {
  try {
    const token = req.cookies.access_token;
    //console.log(token);

    if (!token) {
      res.json({ authenticated: false });
      return;
    }

    jwt.verify(token, "my-secret-key", async (err, decoded) => {
      if (err) {
        res.json({ authenticated: false });
      } else {
        oauth2Client.setCredentials({
          id_token: decoded.googleId,
          access_token: decoded.accessToken,
          refresh_token: decoded.refreshToken,
        });

        const { data } = await axios.get(
          "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
          {
            headers: {
              Authorization: `Bearer ${decoded.accessToken}`,
            },
          }
        );

        res.json({ authenticated: true, user: data });
      }
    });
  } catch (error) {
    console.error("Error checking authentication status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/logout", (req, res) => {
  try {
    // Clear the JWT token by setting an expired cookie
    res.cookie("access_token", "", {
      httpOnly: true,
      expires: new Date(0),
      path: "/", // Set the path to match the initial authentication request
      domain: "api.cyphermanager.com", // Replace with your domain (e.g., localhost)
      secure: true, // Set to true if using HTTPS
    });
    res.json({ message: "Logged out" });
  } catch (err) {
    console.log(err.message);
    res.status(500).json({ message: "Server Error" });
  }
});

//------------------Computaional Routes------------------//

app.get("/getDriveInfo", async (req, res) => {
  const token = req.cookies.access_token;

  if (!token) {
    res.json({ authenticated: false });
    return;
  }

  jwt.verify(token, "my-secret-key", async (err, decoded) => {
    if (err) {
      res.json({ authenticated: false });
      return;
    } else {
      oauth2Client.setCredentials({
        id_token: decoded.googleId,
        access_token: decoded.accessToken,
        refresh_token: decoded.refreshToken,
      });
    }
  });

  const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
  });

  const driveInfo = await drive.about.get({
    fields: "user, storageQuota",
  });

  console.log(driveInfo.data);

  res.json({ success: true, driveInfo: driveInfo.data });
});

app.get("/readDrive", async (req, res) => {
  const token = req.cookies.access_token;

  if (!token) {
    res.json({ authenticated: false });
    return;
  }

  jwt.verify(token, "my-secret-key", async (err, decoded) => {
    if (err) {
      res.json({ authenticated: false });
      return;
    } else {
      oauth2Client.setCredentials({
        id_token: decoded.googleId,
        access_token: decoded.accessToken,
        refresh_token: decoded.refreshToken,
      });
    }
  });

  const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
  });

  const pageSize = 6;

  const { pageToken } = req.query;

  try {
    const response = await drive.files.list({
      pageSize: pageSize,
      fields:
        "nextPageToken, files(id, name, webViewLink, mimeType, size, createdTime, modifiedTime, iconLink, parents, owners, webContentLink, hasThumbnail, thumbnailLink)",
      q: "'me' in owners and mimeType != 'application/vnd.google-apps.folder'",
      pageToken: pageToken ? pageToken : null,
    });

    const filesInRoot = response.data.files;

    // const folderResponse = await drive.files.list({
    //   pageSize: pageSize,
    //   fields: "nextPageToken, files(id, name, parents)",
    //   q: "'me' in owners and mimeType = 'application/vnd.google-apps.folder'",
    //   pageToken: pageToken ? pageToken : null,
    // });

    // const folderFiles = [];
    // for (const folder of folderResponse.data.files) {
    //   const filesInsideFolderResponse = await drive.files.list({
    //     pageSize: pageSize,
    //     fields:
    //       "nextPageToken, files(id, name, webViewLink, mimeType, size, createdTime, modifiedTime, iconLink, parents, owners, webContentLink, hasThumbnail, thumbnailLink)",
    //     q: `'${folder.id}' in parents`,
    //     pageToken: pageToken ? pageToken : null,
    //   });
    //   folderFiles.push(...filesInsideFolderResponse.data.files);
    // }

    const allFiles = [...filesInRoot];

    res.json({
      success: true,
      files: allFiles,
      nextPageToken: response.data.nextPageToken,
    });
  } catch (error) {
    console.log("Error : " + error.message);
  }
});

app.get("/upload", async (req, res) => {
  const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
  });
  const filePath = path.join(__dirname, "test.jpg");

  try {
    const response = await drive.files.create({
      requestBody: {
        name: "drive-upload.jpg",
        mimeType: "image/jpg",
      },
      media: {
        mimeType: "image/jpg",
        body: fs.createReadStream(filePath),
      },
    });

    console.log(response.data);
  } catch (error) {
    throw new Error(error.message);
  }
});

app.post("/delete", async (req, res) => {
  const { fileId } = req.body;
  const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
  });
  try {
    const response = await drive.files.delete({
      fileId: fileId,
    });
    console.log(response.data, response.status);
  } catch (error) {
    throw new Error(error.message);
  }
});

const uploadFileHandler = async (filePath, fileName, mimeType, token) => {
  return new Promise(async (resolve, reject) => {
    if (!token) {
      res.json({ authenticated: false });
      reject();
    }

    jwt.verify(token, "my-secret-key", async (err, decoded) => {
      if (err) {
        reject({ authenticated: false });
      } else {
        oauth2Client.setCredentials({
          id_token: decoded.googleId,
          access_token: decoded.accessToken,
          refresh_token: decoded.refreshToken,
        });

        const drive = google.drive({
          version: "v3",
          auth: oauth2Client,
        });

        try {
          const response = await drive.files.create({
            requestBody: {
              name: fileName,
              mimeType: mimeType,
            },
            media: {
              mimeType: mimeType,
              body: fs.createReadStream(filePath),
            },
          });

          console.log("New File uploaded successfully");
          resolve();
        } catch (error) {
          throw new Error(error.message);
          reject(error);
        }
      }
    });
  });
};

const deleteFileHandler = async (fileId) => {
  const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
  });
  try {
    const response = await drive.files.delete({
      fileId: fileId,
    });
    console.log("Old File deleted successfully");
  } catch (error) {
    throw new Error(error.message);
  }
};

const uploadPhotosLibraryHandler = async (
  filePath,
  fileName,
  mimeType,
  token
) => {
  return new Promise(async (resolve, reject) => {
    if (!token) {
      res.json({ authenticated: false });
      reject();
    }

    jwt.verify(token, "my-secret-key", async (err, decoded) => {
      if (err) {
        res.json({ authenticated: false });
        reject();
      } else {
        oauth2Client.setCredentials({
          id_token: decoded.googleId,
          access_token: decoded.accessToken,
          refresh_token: decoded.refreshToken,
        });

        try {
          const response = await axios.post(
            "https://photoslibrary.googleapis.com/v1/uploads",
            fs.readFileSync(filePath),
            {
              headers: {
                Authorization: `Bearer ${decoded.accessToken}`,
                "Content-type": "application/octet-stream",
                "X-Goog-Content-Type": mimeType,
                "X-Goog-Upload-File-Name": fileName,
                "X-Goog-Upload-Protocol": "raw",
              },
            }
          );

          const uploadToken = response.data;

          const createResponse = await axios.post(
            "https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate",
            {
              newMediaItems: [
                {
                  description: "Optimised by Cypher",
                  simpleMediaItem: {
                    fileName: fileName,
                    uploadToken: uploadToken,
                  },
                },
              ],
            },
            {
              headers: {
                Authorization: `Bearer ${decoded.accessToken}`,
              },
            }
          );

          console.log("New File uploaded successfully");
          resolve();
        } catch (error) {
          console.log(error.message);
          reject(error);
        }
      }
    });
  });
};

app.post("/optimiseSelectedDriveFiles", async (req, res) => {
  const { fileIds, phone, cloudName, autoDelete } = req.body;
  const token = req.cookies.access_token;

  if (!token) {
    res.json({ authenticated: false });
    return;
  }

  if (fileIds.length === 0) {
    res.status(201).json({ error: "No files selected" });
    return;
  }

  const totalFiles = fileIds.length;
  let completedFiles = 0;

  jwt.verify(token, "my-secret-key", async (err, decoded) => {
    if (err) {
      res.json({ authenticated: false });
      return;
    } else {
      oauth2Client.setCredentials({
        id_token: decoded.googleId,
        access_token: decoded.accessToken,
        refresh_token: decoded.refreshToken,
      });

      console.log(decoded.accessToken);

      const drive = google.drive({
        version: "v3",
        auth: oauth2Client,
      });

      try {
        await axiosClient.post("/updateCloudAccountStatus", {
          phone: phone,
          cloudName: cloudName,
          newStatus: "optimising",
        });
        console.log("Status updated to optimising");
      } catch (error) {
        console.log(error.message);
      }

      try {
        for (let i = 0; i < fileIds.length; i++) {
          try {
            const fileMetadata = await drive.files.get({
              fileId: fileIds[i],
              fields: "name, mimeType",
            });

            const fileName = fileMetadata.data.name;
            const fileExtension = fileMetadata.data.mimeType.split("/").pop();
            const videoFilePath = `downloaded/videos/${fileName}`;
            const imageFilePath = `downloaded/images/${fileName}`;
            const pdfFilePath = `downloaded/pdfs/${fileName}`;

            let dest;

            console.log(fileExtension);

            if (
              fileExtension === "mp4" ||
              fileExtension === "mpeg" ||
              fileExtension === "mov" ||
              fileExtension === "x-matroska" ||
              fileExtension === "mkv"
            ) {
              dest = fs.createWriteStream(videoFilePath);
            } else if (
              fileExtension === "jpg" ||
              fileExtension === "png" ||
              fileExtension === "jpeg" ||
              fileExtension === "heic" ||
              fileExtension === "HEIC" ||
              fileExtension === "HEIF" ||
              fileExtension === "heif"
            ) {
              dest = fs.createWriteStream(imageFilePath);
            } else if (fileExtension === "pdf") {
              dest = fs.createWriteStream(pdfFilePath);
            } else {
              console.log("File type not supported, Skipping...");
              completedFiles++;
              continue;
            }

            const response = await drive.files.get(
              {
                fileId: fileIds[i],
                alt: "media",
              },
              { responseType: "stream" }
            );

            response.data
              .on("end", async () => {
                console.log("Download complete");

                let newFileExtension;
                if (
                  fileExtension === "mp4" ||
                  fileExtension === "mpeg" ||
                  fileExtension === "mov" ||
                  fileExtension === "x-matroska" ||
                  fileExtension === "mkv"
                ) {
                  newFileExtension = "mp4";

                  try {
                    const inputPath = videoFilePath;
                    const outputPath = `optimised/videos/opt-${fileName}`;
                    await ffmpegVideoEncodingHandler(
                      inputPath,
                      outputPath,
                      fileExtension
                    );
                    try {
                      await uploadFileHandler(
                        outputPath,
                        `opt-${fileName}`,
                        "video/mp4",
                        req.cookies.access_token
                      );

                      if (autoDelete) {
                        await deleteFileHandler(fileIds[i]);
                      }
                      fs.unlinkSync(inputPath);
                      fs.unlinkSync(outputPath);

                      completedFiles++;
                    } catch (error) {
                      completedFiles++;
                      console.log(error.message);
                    }
                  } catch (error) {
                    completedFiles++;
                    console.log(error.message);
                  }

                  //deleteFileHandler(fileIds[i]);
                } else if (
                  fileExtension === "jpg" ||
                  fileExtension === "png" ||
                  fileExtension === "jpeg" ||
                  fileExtension === "heic" ||
                  fileExtension === "HEIC" ||
                  fileExtension === "HEIF" ||
                  fileExtension === "heif"
                ) {
                  newFileExtension = fileExtension;
                  const inputPath = imageFilePath;
                  console.log(inputPath);
                  const outputPath = `optimised/images/opt-${fileName}`;

                  try {
                    await sharpEncodingHandler(inputPath, outputPath);
                    await uploadFileHandler(
                      outputPath,
                      `opt-${fileName}`,
                      "image/webp",
                      req.cookies.access_token
                    );

                    if (autoDelete) {
                      await deleteFileHandler(fileIds[i]);
                    }

                    fs.unlinkSync(inputPath);
                    fs.unlinkSync(outputPath);

                    completedFiles++;
                  } catch (error) {
                    completedFiles++;
                    console.log(error.message);
                  }

                  //deleteFileHandler(fileIds[i]);
                } else if (fileExtension === "pdf") {
                  newFileExtension = "pdf";
                  const inputPath = pdfFilePath;
                  const outputPath = `optimised/pdfs/opt-${fileName}`;
                  try {
                    const response = await pdfEncodingHandler(
                      inputPath,
                      outputPath
                    );

                    await uploadFileHandler(
                      outputPath,
                      `opt-${fileName}`,
                      "application/pdf",
                      req.cookies.access_token
                    );

                    if (autoDelete) {
                      await deleteFileHandler(fileIds[i]);
                    }

                    fs.unlinkSync(inputPath);
                    fs.unlinkSync(outputPath);

                    completedFiles++;
                  } catch (error) {
                    completedFiles++;
                    console.log(error.message);
                  }

                  //deleteFileHandler(fileIds[i]);
                }
              })
              .on("error", (err) => {
                console.log("Error during download", err);
                completedFiles++;
              })
              .pipe(dest);
          } catch (error) {
            console.log(error.message);
          }
        }

        const intervalId = setInterval(() => {
          if (completedFiles === totalFiles) {
            console.log(completedFiles + "/" + totalFiles);
            clearInterval(intervalId);
            try {
              const updateStatusResponseOptimised = axiosClient.post(
                "/updateCloudAccountStatus",
                {
                  phone: phone,
                  cloudName: cloudName,
                  newStatus: "idle",
                }
              );
              console.log("Status updated to idle");
              res.json({
                success: true,
                message: "Optimisation complete",
              });
            } catch (error) {
              throw new Error(error.message);
            }
          }
        }, 1000);
      } catch (error) {
        console.log(error.message);
      }
    }
  });
});

app.get("/getMediaItems", async (req, res) => {
  try {
    // Read the JWT token from the HTTP-only cookie
    const token = req.cookies.access_token;

    if (!token) {
      res.json({ authenticated: false });
      return;
    }

    jwt.verify(token, "my-secret-key", async (err, decoded) => {
      if (err) {
        res.json({ authenticated: false });
        return;
      } else {
        // Token is valid, user is authenticated
        oauth2Client.setCredentials({
          id_token: decoded.googleId,
          access_token: decoded.accessToken,
          refresh_token: decoded.refreshToken,
        });

        // Initialize Google Photos client
        const albumResponse = await axios.get(
          "https://photoslibrary.googleapis.com/v1/albums",
          {
            headers: {
              Authorization: `Bearer ${decoded.accessToken}`,
            },
            params: {
              pageSize: 20,
            },
          }
        );

        //console.log(albumResponse.data);
        const { pageToken } = req.query;

        const albums = albumResponse.data.albums;

        const mediaItemsResponse = await axios.get(
          "https://photoslibrary.googleapis.com/v1/mediaItems",
          {
            headers: {
              Authorization: `Bearer ${decoded.accessToken}`,
            },
            params: {
              pageSize: 20,
              pageToken: pageToken ? pageToken : "",
            },
          }
        );

        console.log(mediaItemsResponse.data);

        //const albums = await photos.albums.list();

        //const album = await photos.albums.get('ALBUM_ID');

        //const mediaItems = await photos.albums.listMediaItems('ALBUM_ID');

        // Send response to client with listed albums
        res.json({
          success: true,
          albums: albums,
          mediaItems: mediaItemsResponse?.data?.mediaItems,
          nextPageToken: mediaItemsResponse?.data?.nextPageToken,
        });
      }
    });
  } catch (error) {
    console.error("Error accessing Google Photos:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/downloadPhotos", async (req, res) => {
  try {
    // Extract the mediaItemId from the request parameters
    const { mediaItemId } = req.body;
    console.log(mediaItemId);

    // Use the mediaItems.get method to fetch the media item's size

    // Extract and send the sizeBytes in the response
    const sizeBytes = response.data.sizeBytes;
    res.json({ sizeBytes });
  } catch (error) {
    console.error("Error fetching media item size:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/optimiseSelectedMediaItems", async (req, res) => {
  const { phone, cloudName, mediaItemIds } = req.body;
  const token = req.cookies.access_token;

  if (!token) {
    res.json({ authenticated: false });
    return;
  }

  if (mediaItemIds.length === 0) {
    res.status(201).json({ error: "No files selected" });
    return;
  }

  const totalMediaItems = mediaItemIds.length;
  let completedMediaItems = 0;

  jwt.verify(token, "my-secret-key", async (err, decoded) => {
    if (err) {
      res.json({ authenticated: false });
      return;
    } else {
      oauth2Client.setCredentials({
        id_token: decoded.googleId,
        access_token: decoded.accessToken,
        refresh_token: decoded.refreshToken,
      });

      //console.log(decoded.accessToken);

      try {
        const updateStatusResponseOptimising = await axiosClient.post(
          "/updateCloudAccountStatus",
          {
            phone: phone,
            cloudName: cloudName,
            newStatus: "optimising",
          }
        );

        console.log("Status updated to optimising");
      } catch (error) {
        throw new Error(error.message);
      }

      try {
        for (let i = 0; i < mediaItemIds.length; i++) {
          const response = await axios.get(
            `https://photoslibrary.googleapis.com/v1/mediaItems/${mediaItemIds[i]}`,
            {
              headers: {
                Authorization: `Bearer ${decoded.accessToken}`,
              },
            }
          );

          let downloadUrl;
          const filename = response.data.filename;
          const fileExtension = response.data.mimeType.split("/").pop();

          if (
            fileExtension === "mp4" ||
            fileExtension === "mpeg" ||
            fileExtension === "mov" ||
            fileExtension === "x-matroska" ||
            fileExtension === "mkv"
          ) {
            downloadUrl = response.data.baseUrl + "=dv";
          } else {
            downloadUrl = response.data.baseUrl + "=d";
          }

          const downloadResponse = await axios({
            method: "get",
            url: downloadUrl,
            responseType: "stream",
            headers: {
              Authorization: `Bearer ${decoded.accessToken}`,
            },
          });

          if (
            fileExtension === "png" ||
            fileExtension === "jpg" ||
            fileExtension === "jpeg" ||
            fileExtension === "heic" ||
            fileExtension === "HEIC" ||
            fileExtension === "HEIF" ||
            fileExtension === "heif"
          ) {
            const filePath = `downloaded/images/${filename}`;
            const writeFile = fs.createWriteStream(filePath);

            downloadResponse.data.pipe(writeFile);

            downloadResponse.data.on("end", async () => {
              console.log("Download complete");

              const inputPath = filePath;
              const outputPath = `optimised/images/opt-${filename}`;

              try {
                await sharpEncodingHandler(inputPath, outputPath);
                await uploadPhotosLibraryHandler(
                  outputPath,
                  `opt-${filename}`,
                  "image/webp",
                  req.cookies.access_token
                );
                fs.unlinkSync(filePath);
                fs.unlinkSync(outputPath);

                // if (i === mediaItemIds.length - 1) {
                //   try {
                //     const updateStatusResponseIdle = await axiosClient.post(
                //       "/updateCloudAccountStatus",
                //       {
                //         phone: phone,
                //         cloudName: cloudName,
                //         newStatus: "idle",
                //       }
                //     );
                //     res.status(201).json({
                //       success: true,
                //       message: "Optimisation complete",
                //     });
                //     console.log(updateStatusResponseIdle.data);
                //   } catch (error) {
                //     throw new Error(error.message);
                //   }
                // }

                completedMediaItems++;
              } catch (error) {
                completedMediaItems++;
                console.log(error.message);
                fs.unlinkSync(filePath);
                fs.unlinkSync(outputPath);
              }
            });
          } else if (
            fileExtension === "mp4" ||
            fileExtension === "mpeg" ||
            fileExtension === "mov" ||
            fileExtension === "x-matroska" ||
            fileExtension === "mkv"
          ) {
            const filePath = `downloaded/videos/${filename}`;
            const writeFile = fs.createWriteStream(filePath);

            downloadResponse.data.pipe(writeFile);

            downloadResponse.data.on("end", async () => {
              console.log("Download complete");

              const inputPath = filePath;
              const outputPath = `optimised/videos/${filename}`;

              try {
                await ffmpegVideoEncodingHandler(
                  inputPath,
                  outputPath,
                  fileExtension
                );
                await uploadPhotosLibraryHandler(
                  outputPath,
                  `opt-${filename}`,
                  "video/mp4",
                  req.cookies.access_token
                );
                // fs.unlinkSync(filePath);
                // fs.unlinkSync(outputPath);

                // if (i === mediaItemIds.length - 1) {
                //   try {
                //     const updateStatusResponseIdle = await axiosClient.post(
                //       "/updateCloudAccountStatus",
                //       {
                //         phone: phone,
                //         cloudName: cloudName,
                //         newStatus: "idle",
                //       }
                //     );
                //     res.status(201).json({
                //       success: true,
                //       message: "Optimisation complete",
                //     });
                //     console.log(updateStatusResponseIdle.data);
                //   } catch (error) {
                //     throw new Error(error.message);
                //   }
                // }

                completedMediaItems++;
              } catch (error) {
                completedMediaItems++;
                throw new Error(error.message);
              }
            });
          } else {
            console.log(fileExtension);
            console.log("File type not supported, Skipping...");
            completedMediaItems++;
          }

          downloadResponse.data.on("error", (err) => {
            console.log("Error during download", err);
            completedMediaItems++;
          });
        }

        console.log(completedMediaItems, totalMediaItems);

        const intervalId = setInterval(async () => {
          console.log(completedMediaItems + "/" + totalMediaItems);
          if (completedMediaItems === totalMediaItems) {
            try {
              const updateStatusResponseIdle = await axiosClient.post(
                "/updateCloudAccountStatus",
                {
                  phone: phone,
                  cloudName: cloudName,
                  newStatus: "idle",
                }
              );
              res.status(201).json({
                success: true,
                message: "Optimisation complete",
              });
              console.log(updateStatusResponseIdle.data);
            } catch (error) {
              console.log(error.message);
            }
            clearInterval(intervalId);
          }
        }, 2000);
      } catch (error) {
        console.log(error.message);
      }
    }
  });
});

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died`);
    cluster.fork();
  });
} else {
  app.listen(PORT, () => {
    console.log(`Server started using ${process.pid} on port ${PORT}`);
  });
}

// app.listen(8000, () => {
//   console.log(`Server started using ${process.pid} on port 8000`);
// });
