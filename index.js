// ES6 module
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import fs from "fs-extra";
import crypto from "crypto";
import axios from "axios";
import { MultiProgressBars } from "multi-progress-bars";
import chalk from "chalk";

const progressBar = new MultiProgressBars({
  // initMessage: " $ Example Fullstack Build ",
  initMessage: `Download Task`,
  // anchor: "bottom",
  anchor: "top",
  spinnerFPS: 60,
  // progressWidth: 40,
  // persist: false,
  border: true,
});
// progressBar.close();
function formatSpeed(speedInBytesPerSecond, { show_units = true }) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  while (speedInBytesPerSecond >= 1024 && index < units.length - 1) {
    speedInBytesPerSecond /= 1024;
    index++;
  }
  if (!show_units) {
    return speedInBytesPerSecond.toFixed(2);
  }
  return speedInBytesPerSecond.toFixed(2) + " " + units[index];
}

/*
  SHA-1 vs SHA-256 驗證檔案的演算法抉擇問題
    已知 steam 使用 SHA-1 作為檔案驗證的演算法，但是 SHA-1 已經被證實不安全
    但是 SHA-256 也是一個不錯的選擇，但是 steam 並沒有使用 SHA-256 作為檔案驗證的演算法
    由於 SHA-256 會比 SHA-1 更安全，但是 SHA-256 也會比 SHA-1 更耗時
    所以需要有一個平衡來去抉擇要使用哪一個演算法...
    但我選擇妥協使用 SHA-1 作為檔案驗證的演算法，雖然會有一點不安全，但如果未來Novus專案社群如果有更好的說明再來重新做抉擇這個問題 by Yomisana
*/

function downloadFile({
  url = "",
  filename = false,
  destinationDir = "temp",
  // basic settings
  method = "GET",
  responseType = "stream",
}) {
  return new Promise(async (resolve) => {
    if (url !== "") {
      // :/ ok...
      const response = await axios({
        url,
        method: method,
        responseType: responseType,
      });
      // v2
      // I want eat IN-N-OUT :_ BUT MY COUNTRY NO HAVE
      if (!filename) {
        // get all headers
        // const contentDisposition = response.headers;
        const contentDisposition = response.headers["content-disposition"];
        // console.log("contentDisposition", contentDisposition);
        const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
        const matches = filenameRegex.exec(contentDisposition);
        if (contentDisposition != undefined) {
          if (matches != null && matches[1]) {
            filename = matches[1].replace(/['"]/g, "");
          }
        } else {
          filename = path.basename(url);
        }
      }
      // console.log("[OUT]filename", filename);
      const totalLength = response.headers["content-length"];
      // Create the destination directory if it doesn't exist
      // await fs.ensureDir(destinationDir); // Ensure the directory exists
      await fs.ensureDir(path.join(__dirname, "..", destinationDir)); // Ensure the directory exists
      // Create the file path
      // const filePath = path.join(destinationDir, filename);
      const filePath = path.join(__dirname, "..", destinationDir, filename);
      // Check if the file already exists
      if (fs.existsSync(filePath)) {
        // console.log(`File ${filename} already exists.`);
        progressBar.addTask(`${filename}`, {
          type: "indefinite",
          message: `Verification file integrity`,
          // barTransformFn: chalk.green,
          nameTransformFn: chalk.bold,
        });
        const fileHash = await calculateFileHash(filePath);
        const responseHash = await calculateResponseHash(response);
        if (fileHash === responseHash) {
          console.log(
            `Verification of ${filename} integrity completed. Skipping download.`
          );
          progressBar.done(`${filename}`, {
            message: `Done.`,
            barTransformFn: chalk.green,
          });
          resolve(true);
          return;
        } else {
          progressBar.done(`${filename}`, {
            message: `Corrupted. Redownloading...`,
            barTransformFn: chalk.red,
          });
          console.log(
            `Verification of ${filename} is corrupted. Redownloading...`
          );
        }
      }
      console.log(`Downloading ${filename} to ${filePath}`);
      // Create a writer stream (current download file)
      const writer = response.data.pipe(fs.createWriteStream(filePath)); // ram to disk
      progressBar.addTask(`${filename}`, {
        type: "percentage",
        message: `Download Initialization`,
        // barTransformFn: chalk.green,
        nameTransformFn: chalk.bold,
      });
      let downloadedBytes = 0;
      let startTime = Date.now();
      response.data.on("data", (chunk) => {
        downloadedBytes += chunk.length;
        // Calculate download speed
        const currentTime = Date.now();
        const elapsedTimeInSeconds = (currentTime - startTime) / 1000; // covert to seconds
        const downloadSpeed = downloadedBytes / elapsedTimeInSeconds; // download speed = downloaded bytes / elapsed time
        // console.log(`當前下載速度: ${formattedSpeed}`);
        // file left bytes
        let remainingBytes = totalLength - downloadedBytes;
        let remainingTimeInSeconds = remainingBytes / downloadSpeed;
        let hours = Math.floor(remainingTimeInSeconds / 3600);
        let minutes = Math.floor((remainingTimeInSeconds % 3600) / 60);
        let seconds = Math.floor(remainingTimeInSeconds % 60);
        const padZero = (num) => (num < 10 ? "0" : "") + num;
        // console.log(`ETA: ${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)}`);
        // Update progress bar
        const percentage = (downloadedBytes / totalLength) * 1;
        progressBar.updateTask(`${filename}`, {
          percentage,
          message: `${formatSpeed(downloadedBytes, {
            show_units: false,
          })}/${formatSpeed(totalLength, {})} ${formatSpeed(
            downloadSpeed,
            {}
          )}/s eta: ${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)}`,
          // barTransformFn: chalk.green,
        });
      });
      writer.on("finish", () => {
        console.log(`Successfully downloaded ${filename}(${filePath})`);
        progressBar.done(`${filename}`, {
          message: `Done.`,
          barTransformFn: chalk.green,
        });
        writer.end();
        resolve(true);
      });
    }
  });
}

export default function downloadResource(resource, batch_download = 2) {
  return new Promise(async (resolve) => {
    if (Array.isArray(resource)) {
      for (let i = 0; i <= resource.length; i += batch_download) {
        const batch = resource.slice(i, i + batch_download); // 從原始資源中單批次取出n個的資源
        const promises = []; // 用來儲存每個下載的 Promise
        // console.log(`正在下載: ${JSON.stringify(batch)}`);
        for (const obj of batch) {
          promises.push(downloadFile(obj)); // 將每個下載的 Promise 加入陣列
        }
        // 使用 Promise.all 確保所有下載完成
        await Promise.all(promises);
        console.log(
          `Downloaded batch ${i / batch_download + 1} of ${Math.ceil(
            resource.length / batch_download
          )}`
        );
      }
      resolve(true);
    } else {
      // obj or string if
      if (typeof resource === "string") {
        await downloadFile({ url: resource });
      } else {
        await downloadFile(resource);
      }
    }
    resolve(true);
  });
}

// verfiy file hash (SHA-1)
async function calculateFileHash(filePath) {
  const sha1 = crypto.createHash("sha1");
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      sha1.update(chunk);
    });
    stream.on("end", () => {
      resolve(sha1.digest("hex"));
    });
    stream.on("error", (error) => {
      reject(error);
    });
  });
}

async function calculateResponseHash(response) {
  const sha1 = crypto.createHash("sha1");
  return new Promise((resolve, reject) => {
    response.data.on("data", (chunk) => {
      sha1.update(chunk);
    });
    response.data.on("end", () => {
      resolve(sha1.digest("hex"));
    });
    response.data.on("error", (error) => {
      reject(error);
    });
  });
}

// This is test code if you want to test this module
// downloadResource("https://link.testfile.org/15MB");
// module.exports = downloadResource;
