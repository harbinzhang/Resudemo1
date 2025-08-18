/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
// const {onRequest} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started
// const functions = require("firebase-functions");
// const admin = require("firebase-admin");
// const pdfParse = require("pdf-parse");
// const {Storage} = require("@google-cloud/storage");
// const {VertexAI} = require("@google-cloud/vertexai");

// admin.initializeApp();
// const gcs = new Storage();

// // --- configure your region & project ---
// const PROJECT_ID = process.env.GCLOUD_PROJECT;
// const LOCATION = "us-central1"; // match your Vertex region

// // Pick an available model in your project:
// // Check console if gemini-1.5-* is available; otherwise use the “-latest” your project lists.
// const GENERATION_MODEL = "gemini-2.5-flash-001"; // or a *-latest visible in your project

// // exports.onResumeUploaded = functions.storage.object().onFinalize(async (object) => {
// exports.onResumeUploaded = functions.storage.onObjectFinalize(async (object) => {
//     try {
//         const filePath = object.name || "";
//         // if (!filePath.startsWith("resumes/") || !filePath.endsWith(".pdf")) return;
//         if (!filePath.endsWith(".pdf")) return;

//         // 1) Download PDF
//         const [buffer] = await gcs.bucket(object.bucket).file(filePath).download();

//         // 2) Extract text
//         const text = (await pdfParse(buffer)).text;
//         if (!text || text.trim().length < 100) {
//             console.warn("Resume text too short or empty.");
//         }

//         // 3) Call Vertex AI (Gemini) for JSON feedback + keywords
//         const vertexAI = new VertexAI({project: PROJECT_ID, location: LOCATION});
//         const model = vertexAI.getGenerativeModel({model: GENERATION_MODEL});

//         const system = `You are an expert resume reviewer for software/tech roles.
// Return STRICT JSON with the following schema:
// {
//     "summary": "2-4 sentences",
//     "strengths": ["..."],
//     "gaps": ["..."],
//     "suggested_improvements": ["..."],
//     "role_suggestions": ["..."],
//     "keywords": {
//          "skills": ["normalized technical skills"],
//          "tools": ["frameworks/libraries"],
//          "domains": ["areas like backend, ML, data"],
//          "seniority": "Junior|Mid|Senior"
//     }
// }`;

//         const prompt = `Resume text:\n${text}\n\nGenerate the JSON now. Do not include explanations.`;

//         const resp = await model.generateContent({
//             contents: [
//                 {role: "user", parts: [{text: system}]},
//                 {role: "user", parts: [{text: prompt}]},
//             ],
//             generationConfig: {responseMimeType: "application/json"},
//         });

//         const raw = resp.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
//         let parsed;
//         try { parsed = JSON.parse(raw); } catch { parsed = {rawText: raw}; }

//         // 4) Save to Firestore alongside the file
//         // Use filePath as doc id or derive a resumeId from it
//         // const resumeDocId = filePath.replace(/\//g, "__");
//         // await admin.firestore().collection("resumes").doc(resumeDocId).set({
//         //     filePath,
//         //     ownerId: object.metadata?.uid || null, // if you attached uid at upload time
//         //     feedback: parsed,
//         //     createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         //     model: GENERATION_MODEL,
//         // }, {merge: true});

//         // console.log("Resume analyzed:", resumeDocId);

//         const fileID = object.metadata?.fileID; // Read fileID from custom metadata
//         if (!fileID) {
//             console.error("File ID not found in metadata.");
//             return;
//         }

//         await admin.firestore().collection("file").doc(fileID).set(
//             {
//                 feedback: parsed,
//                 analysisAvailable: true,
//                 updatedAt: admin.firestore.FieldValue.serverTimestamp(),
//             }, {
//                 merge: true
//             });
//         console.log("Feedback saved in Firestore for file:", fileID);

//     } catch (e) {
//         console.error("onResumeUploaded error", e);
//     }
// });
// // exports.helloWorld = onRequest((request, response) => {
// //     logger.info("Hello logs!", {structuredData: true});
// //     response.send("Hello from Firebase!");
// // });

// functions/index.js

// Firebase Functions v2 (Storage)
const {onObjectFinalized} = require("firebase-functions/v2/storage");
// const logger = require("firebase-functions/logger");

const admin = require("firebase-admin");
const pdfParse = require("pdf-parse");
const {Storage} = require("@google-cloud/storage");
const {VertexAI} = require("@google-cloud/vertexai");

admin.initializeApp();
const gcs = new Storage();

// --- configure your region & project ---
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const LOCATION = "us-central1"; // "us-central1"; // match your Vertex region

// Pick an available model in your project
const GENERATION_MODEL = "gemini-2.5-flash-001"; // or a *-latest visible in your project

exports.onResumeUploaded = onObjectFinalized(
    {
      region: LOCATION, // keep close to your bucket/Vertex region
      // memory: "512MiB",
      // timeoutSeconds: 120,
      // cpu: 1,
      // secrets: [], // if you ever need secrets
    },
    async (event) => {
      try {
        // v2 storage event
        const object = event.data; // StorageObject
        const filePath = object.name || "";
        if (!filePath) {
          logger.warn("No object.name in event; exiting.");
          return;
        }

        // if (!filePath.startsWith("resumes/") || !filePath.endsWith(".pdf")) return;
        if (!filePath.endsWith(".pdf")) {
          logger.debug(`Skipping non-PDF file: ${filePath}`);
          return;
        }

        const bucketName = object.bucket;
        if (!bucketName) {
          logger.error("Missing bucket in event data.");
          return;
        }

        // 1) Download PDF
        const [buffer] = await gcs.bucket(bucketName).file(filePath).download();

        // 2) Extract text
        const text = (await pdfParse(buffer)).text || "";
        if (text.trim().length < 100) {
          logger.warn("Resume text too short or empty.");
        }

        // 3) Call Vertex AI (Gemini) for JSON feedback + keywords
        const vertexAI = new VertexAI({project: PROJECT_ID, location: LOCATION});
        const model = vertexAI.getGenerativeModel({model: GENERATION_MODEL});

        const system = `You are an expert resume reviewer for software/tech roles.
  Return STRICT JSON with the following schema:
  {
    "summary": "2-4 sentences",
    "strengths": ["..."],
    "gaps": ["..."],
    "suggested_improvements": ["..."],
    "role_suggestions": ["..."],
    "keywords": {
      "skills": ["normalized technical skills"],
      "tools": ["frameworks/libraries"],
      "domains": ["areas like backend, ML, data"],
      "seniority": "Junior|Mid|Senior"
    }
  }`;

        const prompt = `Resume text:\n${text}\n\nGenerate the JSON now. Do not include explanations.`;

        const resp = await model.generateContent({
          contents: [
            {role: "user", parts: [{text: system}]},
            {role: "user", parts: [{text: prompt}]},
          ],
          generationConfig: {responseMimeType: "application/json"},
        });

        const raw =
          resp.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = {rawText: raw};
        }

        // 4) Save to Firestore alongside the file
        const fileID = object.metadata?.fileID; // Read fileID from custom metadata
        if (!fileID) {
          logger.error("File ID not found in metadata.");
          return;
        }

        await admin
            .firestore()
            .collection("file")
            .doc(fileID)
            .set(
                {
                  feedback: parsed,
                  analysisAvailable: true,
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  model: GENERATION_MODEL,
                  sourcePath: filePath,
                  bucket: bucketName,
                },
                {merge: true}, // Added comma
            );

        logger.info("Feedback saved in Firestore for file", {fileID, filePath});
      } catch (e) {
        logger.error("onResumeUploaded error", e);
        throw e; // surface error to logs/metrics
      }
    }, // Added comma
);
