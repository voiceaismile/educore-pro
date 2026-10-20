/**
 * =========================================================================
 * 📸 EDUCORE IMGBB CLOUD IMAGE UPLOAD ENGINE (API v1)
 * =========================================================================
 * Uploads school logos, student photos, and document badges to ImgBB
 * Returns persistent HTTPS image URLs for instant display and printing.
 * =========================================================================
 */

export const IMGBB_API_KEY = "ad4c0db12ac7b8017c4f91dcee725414";
export const IMGBB_ENDPOINT = "https://api.imgbb.com/1/upload";

/**
 * Upload an image (File object or base64 string) to ImgBB API v1
 * @param {File|Blob|string} imageFile - The file to upload
 * @returns {Promise<string>} The live display URL on ImgBB
 */
export async function uploadImageToImgbb(imageFile) {
  if (!imageFile) throw new Error("No image file provided for upload.");

  const formData = new FormData();
  formData.append("key", IMGBB_API_KEY);

  if (typeof imageFile === "string") {
    // If base64 data url, extract pure base64 payload
    if (imageFile.startsWith("data:")) {
      const base64Data = imageFile.split(",")[1];
      formData.append("image", base64Data);
    } else {
      formData.append("image", imageFile);
    }
  } else {
    // Standard File or Blob object
    formData.append("image", imageFile);
  }

  try {
    const response = await fetch(`${IMGBB_ENDPOINT}?key=${IMGBB_API_KEY}`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ImgBB upload error (${response.status}): ${errText}`);
    }

    const result = await response.json();

    if (result.success && result.data) {
      // Prefer direct image display URL
      return result.data.display_url || result.data.url;
    } else {
      throw new Error(result.error?.message || "ImgBB upload failed.");
    }
  } catch (error) {
    console.error("ImgBB upload failed:", error);
    throw error;
  }
}
