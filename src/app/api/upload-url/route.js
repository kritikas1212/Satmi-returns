import { NextResponse } from 'next/server';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export async function POST(request) {
  try {
    const { fileName, fileType } = await request.json();
    
    if (!fileName || !fileType) {
      return NextResponse.json(
        { success: false, error: "File name and type are required", code: "MISSING_FILE_INFO" },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
    if (!allowedTypes.includes(fileType)) {
      return NextResponse.json(
        { success: false, error: "Invalid file type. Only video files are allowed.", code: "INVALID_FILE_TYPE" },
        { status: 400 }
      );
    }

    // Generate unique file name
    const timestamp = Date.now();
    const uniqueFileName = `returns/${timestamp}-${fileName}`;
    
    // Initialize Firebase Storage
    const storage = getStorage();
    const storageRef = ref(storage, uniqueFileName);
    
    // Generate a signed upload URL
    const { getSignedUrl } = await import('firebase-admin/storage');
    
    const signedUrl = await getSignedUrl(storageRef, {
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType: fileType,
    });

    // Generate the public URL that will be available after upload
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${storageRef.bucket}/o/${encodeURIComponent(uniqueFileName)}?alt=media`;

    return NextResponse.json({
      success: true,
      uploadUrl: signedUrl,
      publicUrl: publicUrl,
      fileName: uniqueFileName,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });

  } catch (error) {
    console.error('Upload URL generation error:', error);
    return NextResponse.json(
      { success: false, error: "Failed to generate upload URL", code: "UPLOAD_URL_ERROR", details: error.message },
      { status: 500 }
    );
  }
}
