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

const { ffmpegVideoEncodingHandler } = require("./videoEncoder");
const { sharpEncodingHandler } = require("./sharp");
const { pdfEncodingHandler } = require("./pdfEncoder");
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
const REDIRECT_URI = "http://localhost:8000/google/redirect";

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

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
  });
  res.redirect(url);
});

app.get("/google/redirect", async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);

  oauth2Client.setCredentials(tokens);

  // Create a JWT token with user information
  const user = {
    googleId: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  };
  const token = jwt.sign(user, "my-secret-key");

  // Set the JWT token as an HTTP-only cookie
  res.cookie("access_token", token, { httpOnly: true });
  res.redirect("http://localhost:5000/googleCloud");
});

app.get("/checkAuth", (req, res) => {
  try {
    // Read the JWT token from the HTTP-only cookie
    const token = req.cookies.access_token;
    //console.log(token);

    if (!token) {
      res.json({ authenticated: false });
      return;
    }

    // Verify the JWT token and extract user information
    jwt.verify(token, "my-secret-key", async (err, decoded) => {
      if (err) {
        res.json({ authenticated: false });
      } else {
        // Token is valid, user is authenticated

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
      domain: "localhost", // Replace with your domain (e.g., localhost)
      secure: false, // Set to true if using HTTPS
    });
    res.json({ message: "Logged out" });
  } catch (err) {
    console.log(err.message);
    res.status(500).json({ message: "Server Error" });
  }
});

//------------------Computaional Routes------------------//

app.get("/readDrive", async (req, res) => {
  const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
  });
  const response = await drive.files.list({
    pageSize: 10,
    fields:
      "nextPageToken, files(id, name, webViewLink, mimeType, size, createdTime, modifiedTime, iconLink, parents, owners, webContentLink, hasThumbnail, thumbnailLink)",
    q: "'me' in owners and mimeType != 'application/vnd.google-apps.folder'",
  });

  const filesInRoot = response.data.files;

  const folderResponse = await drive.files.list({
    pageSize: 10,
    fields: "nextPageToken, files(id, name, parents)",
    q: "'me' in owners and mimeType = 'application/vnd.google-apps.folder'",
  });

  const folderFiles = [];
  for (const folder of folderResponse.data.files) {
    const filesInsideFolderResponse = await drive.files.list({
      pageSize: 10,
      fields:
        "nextPageToken, files(id, name, webViewLink, mimeType, size, createdTime, modifiedTime, iconLink, parents, owners, webContentLink, hasThumbnail, thumbnailLink)",
      q: `'${folder.id}' in parents`,
    });
    folderFiles.push(...filesInsideFolderResponse.data.files);
  }

  const allFiles = [...filesInRoot, ...folderFiles];

  res.json({ success: true, files: allFiles });
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
    console.log(error.message);
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
    console.log(error.message);
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
          console.log(error.message);
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
    console.log(error.message);
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

  jwt.verify(token, "my-secret-key", async (err, decoded) => {
    if (err) {
      res.json({ authenticated: false });
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
        const updateStatusResponseOptimised = await axiosClient.post(
          "/updateCloudAccountStatus",
          {
            phone: phone,
            cloudName: cloudName,
            newStatus: "optimising",
          }
        );
        console.log(updateStatusResponseOptimised.data);
      } catch (error) {
        console.log(error.message);
      }

      for (let i = 0; i < fileIds.length; i++) {
        try {
          const fileMetadata = await drive.files.get({
            fileId: fileIds[i],
            fields: "name, mimeType",
          });

          const fileName = fileMetadata.data.name;
          const fileExtension = fileMetadata.data.mimeType.split("/").pop();
          const videoFilePath = `downloaded/videos/${fileName}-${Date.now()}.mp4`;
          const imageFilePath = `downloaded/images/${fileName}-${Date.now()}.${fileExtension}`;
          const pdfFilePath = `downloaded/pdfs/${fileName}-${Date.now()}.${fileExtension}`;

          let dest;

          console.log(fileExtension);

          if (fileExtension === "mp4" || fileExtension === "mpeg") {
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
            if (i === fileIds.length - 1) {
              try {
                const updateStatusResponseOptimised = await axiosClient.post(
                  "/updateCloudAccountStatus",
                  {
                    phone: phone,
                    cloudName: cloudName,
                    newStatus: "idle",
                  }
                );
                console.log(updateStatusResponseOptimised.data);
              } catch (error) {
                console.log(error.message);
              }
              res.json({
                message:
                  "single or multiple file type is not supported, skipped.",
              });
            }

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
              res.json({ message: "Optimisation Started" });

              let newFileExtension;
              if (fileExtension === "mp4" || fileExtension === "mpeg") {
                newFileExtension = "mp4";
                const inputPath = videoFilePath;
                const outputPath = `optimised/videos/opt-${fileName}`;
                await ffmpegVideoEncodingHandler(inputPath, outputPath);
                try {
                  await uploadFileHandler(
                    outputPath,
                    `${fileName}-opt-${Date.now()}.${newFileExtension}`,
                    "video/mp4",
                    req.cookies.access_token
                  );

                  if (autoDelete) {
                    await deleteFileHandler(fileIds[i]);
                  }
                  fs.unlinkSync(inputPath);
                  fs.unlinkSync(outputPath);

                  if (i === fileIds.length - 1) {
                    try {
                      const updateStatusResponseOptimised =
                        await axiosClient.post("/updateCloudAccountStatus", {
                          phone: phone,
                          cloudName: cloudName,
                          newStatus: "idle",
                        });
                      console.log(updateStatusResponseOptimised.data);
                    } catch (error) {
                      console.log(error.message);
                    }
                  }
                } catch (error) {
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
                newFileExtension = "webp";
                const inputPath = imageFilePath;
                console.log(inputPath);
                const outputPath = `optimised/images/opt-${fileName}`;
                await sharpEncodingHandler(inputPath, outputPath);

                try {
                  await uploadFileHandler(
                    outputPath,
                    `${fileName}-opt-${Date.now()}.${newFileExtension}`,
                    "image/webp",
                    req.cookies.access_token
                  );

                  if (autoDelete) {
                    await deleteFileHandler(fileIds[i]);
                  }

                  fs.unlinkSync(inputPath);
                  fs.unlinkSync(outputPath);

                  if (i === fileIds.length - 1) {
                    try {
                      const updateStatusResponseOptimised =
                        await axiosClient.post("/updateCloudAccountStatus", {
                          phone: phone,
                          cloudName: cloudName,
                          newStatus: "idle",
                        });
                      console.log(updateStatusResponseOptimised.data);
                    } catch (error) {
                      console.log(error.message);
                    }
                  }
                } catch (error) {
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
                    `${fileName}-opt-${Date.now()}.${newFileExtension}`,
                    "application/pdf",
                    req.cookies.access_token
                  );

                  if (autoDelete) {
                    await deleteFileHandler(fileIds[i]);
                  }

                  fs.unlinkSync(inputPath);
                  fs.unlinkSync(outputPath);

                  if (i === fileIds.length - 1) {
                    try {
                      const updateStatusResponseOptimised =
                        await axiosClient.post("/updateCloudAccountStatus", {
                          phone: phone,
                          cloudName: cloudName,
                          newStatus: "idle",
                        });
                      console.log(updateStatusResponseOptimised.data);
                    } catch (error) {
                      console.log(error.message);
                    }
                  }
                } catch (error) {
                  console.log(error.message);
                }

                //deleteFileHandler(fileIds[i]);
              }
            })
            .on("error", (err) => {
              console.log("Error during download", err);
              res.status(500).json({ error: "Error during download" });
            })
            .pipe(dest);
        } catch (error) {
          console.log(error.message);
          res.status(500).json({ error: "Error during download" });
        }
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

        const albums = albumResponse.data.albums;

        const mediaItemsResponse = await axios.get(
          "https://photoslibrary.googleapis.com/v1/mediaItems",
          {
            headers: {
              Authorization: `Bearer ${decoded.accessToken}`,
            },
            params: {
              pageSize: 20,
            },
          }
        );

        //console.log(mediaItemsResponse.data);
        const mediaItems = mediaItemsResponse.data.mediaItems;

        // download media items in a specific path to local storage

        // List all albums
        //const albums = await photos.albums.list();

        // Or get a specific album by ID
        //const album = await photos.albums.get('ALBUM_ID');

        // You can also list all media items in an album
        //const mediaItems = await photos.albums.listMediaItems('ALBUM_ID');

        // Send response to client with listed albums
        res.json({ success: true, albums: albums, mediaItems: mediaItems });
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

  jwt.verify(token, "my-secret-key", async (err, decoded) => {
    if (err) {
      res.json({ authenticated: false });
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

        console.log(updateStatusResponseOptimising.data);
      } catch (error) {
        console.log(error.message);
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

          if (fileExtension === "mp4" || fileExtension === "mpeg") {
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
              await sharpEncodingHandler(inputPath, outputPath);
              try {
                await uploadPhotosLibraryHandler(
                  outputPath,
                  `opt-${filename}`,
                  "image/webp",
                  req.cookies.access_token
                );
                fs.unlinkSync(filePath);
                fs.unlinkSync(outputPath);

                if (i === mediaItemIds.length - 1) {
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
                }
              } catch (error) {
                console.log(error.message);
                fs.unlinkSync(filePath);
                fs.unlinkSync(outputPath);
              }
            });
          } else if (fileExtension === "mp4" || fileExtension === "mpeg") {
            const filePath = `downloaded/videos/${filename}`;
            const writeFile = fs.createWriteStream(filePath);

            downloadResponse.data.pipe(writeFile);

            downloadResponse.data.on("end", async () => {
              console.log("Download complete");

              const inputPath = filePath;
              const outputPath = `optimised/videos/${filename}`;
              await ffmpegVideoEncodingHandler(inputPath, outputPath);
              try {
                await uploadPhotosLibraryHandler(
                  outputPath,
                  `opt-${filename}`,
                  "video/mp4",
                  req.cookies.access_token
                );
                fs.unlinkSync(filePath);
                fs.unlinkSync(outputPath);

                if (i === mediaItemIds.length - 1) {
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
                }
              } catch (error) {
                console.log(error.message);
                fs.unlinkSync(filePath);
                fs.unlinkSync(outputPath);
              }
            });
          } else {
            console.log(fileExtension);
            console.log("File type not supported, Skipping...");
          }

          downloadResponse.data.on("error", (err) => {
            console.log("Error during download", err);
            res.status(500).json({ error: "Error during download" });
          });
        }
      } catch (error) {
        console.log(error.message);
        res.status(500).json({ error: "Error during download" });
      }
    }
  });
});

if(cluster.isMaster){
  console.log(`Master ${process.pid} is running`);

  for(let i = 0; i < numCPUs; i++){
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died`);
    cluster.fork();
  })
}else{
  app.listen(8000, () => {
    console.log(`Server started using ${process.pid} on port 8000`);
  });
}
