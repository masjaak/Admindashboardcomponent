const admin = require("firebase-admin");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");

admin.initializeApp();
setGlobalOptions({ region: "asia-southeast2", maxInstances: 10 });

const db = admin.firestore();

async function assertManager(auth) {
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const callerRef = db.collection("admin_users").doc(auth.uid);
  const callerSnap = await callerRef.get();
  if (!callerSnap.exists) {
    throw new HttpsError("permission-denied", "Admin profile not found.");
  }

  const caller = callerSnap.data() || {};
  if (caller.active === false || caller.role !== "manager") {
    throw new HttpsError("permission-denied", "Manager access required.");
  }

  return { uid: auth.uid, profile: caller };
}

function normalizeText(value, field) {
  const next = String(value || "").trim();
  if (!next) {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  return next;
}

exports.createAdminUser = onCall(async (request) => {
  const { auth, data } = request;
  const manager = await assertManager(auth);

  const email = normalizeText(data?.email, "email").toLowerCase();
  const password = normalizeText(data?.password, "password");
  const name = normalizeText(data?.name, "name");
  const username = normalizeText(data?.username, "username");
  const hotelId = normalizeText(data?.hotelId, "hotelId");
  const role = data?.role === "manager" ? "manager" : "staff";
  const active = data?.active !== false;

  const userRecord = await admin.auth().createUser({
    email,
    password,
    displayName: name,
    disabled: !active,
  });

  await db.collection("admin_users").doc(userRecord.uid).set({
    name,
    email,
    username,
    role,
    hotelId,
    active,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: manager.uid,
  });

  return { uid: userRecord.uid };
});

exports.updateAdminProfile = onCall(async (request) => {
  const { auth, data } = request;
  await assertManager(auth);

  const uid = normalizeText(data?.uid, "uid");
  const name = normalizeText(data?.name, "name");
  const username = normalizeText(data?.username, "username");
  const role = data?.role === "manager" ? "manager" : "staff";
  const active = data?.active !== false;

  const docRef = db.collection("admin_users").doc(uid);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Admin user not found.");
  }

  await docRef.set({
    name,
    username,
    role,
    active,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await admin.auth().updateUser(uid, {
    displayName: name,
    disabled: !active,
  });

  return { ok: true };
});

exports.updateAdminPassword = onCall(async (request) => {
  const { auth, data } = request;
  await assertManager(auth);

  const uid = normalizeText(data?.uid, "uid");
  const newPassword = normalizeText(data?.newPassword, "newPassword");
  if (newPassword.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }

  await admin.auth().updateUser(uid, { password: newPassword });
  await db.collection("admin_users").doc(uid).set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

exports.deleteAdminUser = onCall(async (request) => {
  const { auth, data } = request;
  const manager = await assertManager(auth);

  const uid = normalizeText(data?.uid, "uid");
  if (uid === manager.uid) {
    throw new HttpsError("failed-precondition", "Managers cannot delete their own account.");
  }

  await db.collection("admin_users").doc(uid).delete();
  await admin.auth().deleteUser(uid);

  return { ok: true };
});

