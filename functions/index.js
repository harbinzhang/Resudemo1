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
const LOCATION = "us-west1"; // "us-central1"; // match your Vertex region

// Pick an available model in your project
const GENERATION_MODEL = "gemini-2.5-flash"; // "gemini-2.5-flash-001"; // or a *-latest visible in your project

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

        // await admin
        //     .firestore()
        //     .collection("file")
        //     .doc(fileID)
        //     .set(
        //         {
        //           feedback: parsed,
        //           analysisAvailable: true,
        //           updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        //           model: GENERATION_MODEL,
        //           sourcePath: filePath,
        //           bucket: bucketName,
        //         },
        //         {merge: true}, // Added comma
        //     );

        const fileRef = admin.firestore().collection("file").doc(fileID);
        await admin.firestore().runTransaction(async (transaction) => {
          const fileDoc = await transaction.get(fileRef);

          if (!fileDoc.exists) {
            logger.error(`File document not found for fileID: ${fileID}`);
            return;
          }

          const currentNumAnalysis = fileDoc.data().numAnalysis || 0;
          const newIdx = currentNumAnalysis + 1;
          const analysisID = `${fileID}-${newIdx}`;

          transaction.update(fileRef, {
            lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
            numAnalysis: newIdx,
            [`analysis.${newIdx}`]: analysisID, // Add to `analysis` dict
          });

          // Add a new document to `collection('analysis')`
          const analysisRef = admin.firestore().collection("analysis").doc(analysisID);
          transaction.set(analysisRef, {
            owner: fileDoc.data().owner || object.metadata?.owner || "", // Ensure owner is set
            fileID: fileID,
            content: parsed, // Feedback JSON from Vertex AI
            generateTime: admin.firestore.FieldValue.serverTimestamp(),
            model: GENERATION_MODEL,
            userRating: null, // Initialize as null
            userComment: null, // Initialize as null
            nextAnalysis: null, // Initialize as null
          });
        });

        // logger.info("Analysis saved in Firestore", {fileID, analysisID});

        logger.info("Feedback saved in Firestore for file", {fileID, filePath});
      } catch (e) {
        logger.error("onResumeUploaded error", e);
        throw e; // surface error to logs/metrics
      }
    }, // Added comma
);

//                                            //
//                                            //
/* ----- New script for re-gen analysis ----- */
//                                            //
//                                            //
const {onRequest} = require("firebase-functions/v2/https");
const {FieldValue} = require("firebase-admin/firestore");
// const {VertexAI} = require("@google-cloud/vertexai");

exports.generateNewAnalysis = onRequest(async (req, res) => {
  try {
    // Step 1: Parse request data
    const {fileID, analysisID, userRating, userComment} = req.body;

    if (!fileID || !analysisID || !userRating || !userComment) {
      res.status(400).send({error: "Missing required parameters."});
      return;
    }

    // Step 2: Retrieve existing analysis data
    const analysisDoc = await admin.firestore().collection("analysis").doc(analysisID).get();
    if (!analysisDoc.exists) {
      res.status(404).send({error: "Analysis document not found."});
      return;
    }

    const analysisData = analysisDoc.data();

    // Step 3: Prepare the prompt for Vertex AI
    const vertexAI = new VertexAI({project: PROJECT_ID, location: LOCATION});
    const model = vertexAI.getGenerativeModel({model: GENERATION_MODEL});

    const prompt = `
You are an expert resume reviewer for software/tech roles. Here's the previous analysis:
${JSON.stringify(analysisData.content)}

The user provided the following feedback:
- Rating: ${userRating}
- Comment: ${userComment}

Generate a revised analysis using the same schema as before:
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
}
    `;

    const response = await model.generateText({content: prompt});
    const newContent = JSON.parse(response.content); // Parse the new analysis JSON

    // Step 4: Update Firestore with the new analysis
    const fileRef = admin.firestore().collection("file").doc(fileID);
    const fileDoc = await fileRef.get();

    if (!fileDoc.exists) {
      res.status(404).send({error: "File document not found."});
      return;
    }

    const numAnalysis = fileDoc.data().numAnalysis || 0;
    const newIndex = numAnalysis + 1;
    const newAnalysisID = `${fileID}-${newIndex}`;

    // Run Firestore updates in a transaction
    await admin.firestore().runTransaction(async (transaction) => {
      // Update `file` document
      transaction.update(fileRef, {
        lastUpdate: FieldValue.serverTimestamp(),
        numAnalysis: newIndex,
        [`analysis.${newIndex}`]: newAnalysisID,
      });

      // Add new analysis document
      const newAnalysisRef = admin.firestore().collection("analysis").doc(newAnalysisID);
      transaction.set(newAnalysisRef, {
        owner: fileDoc.data().owner,
        fileID: fileID,
        content: newContent,
        generateTime: FieldValue.serverTimestamp(),
        model: GENERATION_MODEL,
        userRating: null, // Initially null
        userComment: null, // Initially null
        nextAnalysis: null, // Initially null
      });

      // Update the `nextAnalysis` field in the previous analysis
      transaction.update(admin.firestore().collection("analysis").doc(analysisID), {
        nextAnalysis: newAnalysisID,
      });
    });

    // Step 5: Respond to the frontend
    res.status(200).send({newAnalysisID});

  } catch (error) {
    console.error("Error generating new analysis:", error);
    res.status(500).send({error: "Internal server error."});
  }
});
