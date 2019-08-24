/*
  Experimental stream.
*/

class ZipperStream {

  constructor() {
    const self = this;

    this.readable = new ReadableStream({
      start(controller) {
        self._controllerEnqueue = (chunk) => controller.enqueue(chunk);
        self._controllerClose = () => controller.close();
      }
    });

    this._totalBytes = 0;
    this._cd = [];
  }

  _enqueue(chunk) {
    if (typeof this._controllerEnqueue === 'function') {
      this._controllerEnqueue(chunk);
      this._totalBytes += chunk.length;
    }
  }

  _close() {
    if (typeof this._controllerClose === 'function') {
      this._controllerClose();
    }
  }

  getReader() {
    return this.readable.getReader();
  }

  pipeTo(stream) {
    return this.readable.pipeTo(stream);
  }

  async addStream(filename, readStream, callback) {

    // Filename must be a string.

    if (typeof filename !== 'string') {
      this._error(`Zipper (${this._cd.length}): Filename must be a string. Skipping.`);
      return this._cd.length;
    }

    // Reduce multiple '/' characters, and remove start/end '/' characters.
    // This is done by unzip if detected, but this will save the warnings.

    filename = filename
      .replace(/\/+/g, '/')
      .replace(/^\//, '')
      .replace(/\/$/, '');

    // Check if theres anything left after trimming all the '/' characters.

    if (filename.length === 0) {
      this._error(`Zipper (${this._cd.length}): Filename is required. Skipping.`);
      return this._cd.length;
    }

    const offset = this._totalBytes;

    // Generate a local header.

    const currentDate = new Date();
    const extraField = '';

    const timeBytes = timeToBytes(currentDate);
    const dateBytes = dateToBytes(currentDate);
    const filenameLengthBytes = numberToBytes(filename.length, 2);
    const extraFieldLengthBytes = numberToBytes(extraField.length, 2);
    const filenameBytes = stringToBytes(filename);
    const extraFieldBytes = stringToBytes(extraField);

    this._enqueue(new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,     // 4 - Signature (unchanging).
      0x14, 0x00,                 // 2 - Version needed for data descriptor (20 = 2.0).
      0x08, 0x00,                 // 2 - Flags (Data Descriptor flag set).
      0x00, 0x00,                 // 2 - Compression method (none).
      ...timeBytes,               // 2 - File modification time.
      ...dateBytes,               // 2 - File modification date.
      0x00, 0x00, 0x00, 0x00,     // 4 - CRC-32 checksum (UNKNOWN).
      0x00, 0x00, 0x00, 0x00,     // 4 - Compressed size (UNKNOWN).
      0x00, 0x00, 0x00, 0x00,     // 4 - Uncompressed size (UNKNOWN).
      ...filenameLengthBytes,     // 2 - Filename length (5).
      ...extraFieldLengthBytes,   // 2 - Extra field length (21).
      ...filenameBytes,           // N - Filename.
      ...extraFieldBytes,         // N - Extra OS properties, such as more accurate timestamp (?).
    ]));

    // Stream file data.

    let crc = -1;
    let fileLength = 0;
    let i = 0;

    while (true) {

      // Check if the stream has finished.
      const { done, value } = await readStream.read();
      if (done) {
        break;
      }

      // If the max length is exceeded, cancel stream
      // to indicate that no more data is wanted.
      // TODO: Potentially throw error here?
      fileLength += value.length;
      if (fileLength > 0xFFFFFFFF) {
        await readStream.cancel();
        break;
      }

      // Pipe next chunk.
      this._enqueue(value);

      // Maintain checksum.
      while (i < fileLength) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ value[i]) & 0xFF];
        i++;
      }
    }

    // Make sure data doesn't exceed maximum size.
    // TODO: Handle this properly with the stream.
    if (fileLength > 0xFFFFFFFF) {
      this._error(`Zipper (${this._cd.length}): File exceeds maximum size of 4294967295 bytes. Skipping.`);
      return;
    }

    // Generate Data descriptor.

    const checksum = (crc ^ (-1)) >>> 0;

    const checksumBytes = numberToBytes(checksum, 4);
    const sizeBytes = numberToBytes(fileLength, 4);

    this._enqueue(new Uint8Array([
      0x50, 0x4b, 0x07, 0x08,     // 4 - Data descriptor signature (unchanging).
      ...checksumBytes,           // 4 - CRC-32 Checksum.
      ...sizeBytes,               // 4 - Compressed Size.
      ...sizeBytes,               // 4 - Uncompressed Size.
    ]));

    // Generate Central Directory header to be included in the
    // Central Directory at the end of the zip file.

    const isFolder = false;
    const fileComment = '';

    const diskStartBytes = numberToBytes(0, 2);
    const offsetBytes = numberToBytes(offset, 4);
    const externalBytes = isFolder ? [0x10, 0x00, 0xed, 0x41] : [0x00, 0x00, 0xa4, 0x81];
    const fileCommentBytes = stringToBytes(fileComment);
    const fileCommentLengthBytes = numberToBytes(fileCommentBytes.length, 2);

    this._cd.push(new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,     // 4 - Signature (always this).
      0x2d, 0x03,                 // 2 - What was this zip file made with? Upper = 45, or 3.0 (VERSION), lower = 3 (UNIX).
      0x14, 0x00,                 // 2 - Version needed for data descriptor (20 = 2.0).
      0x08, 0x00,                 // 2 - Flags (Data Descriptor flag set).
      0x00, 0x00,                 // 2 - Compression method (0 = none).
      ...timeBytes,               // 2 - File modification time.
      ...dateBytes,               // 2 - File modification date.
      ...checksumBytes,           // 4 - CRC-32 checksum.
      ...sizeBytes,               // 4 - Compressed size (69).
      ...sizeBytes,               // 4 - Uncompressed size (69).
      ...filenameLengthBytes,     // 2 - Filename length (5).
      ...extraFieldLengthBytes,   // 2 - Extra field length (21).
      ...fileCommentLengthBytes,  // 2 - Length of optional file comments.
      ...diskStartBytes,          // 2 - Number of disk this file is on (always 0).
      0x00, 0x00,                 // 2 - Internal file properties. (1st bit = hint of ASCII/text text file)
      ...externalBytes,           // 4 - External file properties (host specific). First bit marks folder. The last 2 bytes seem to control file permissions.
      ...offsetBytes,             // 4 - Offset of local header from start of first disk.
      ...filenameBytes,           // N - Filename.
      ...extraFieldBytes,         // N - Extra field bytes.
      ...fileCommentBytes,        // N - Comment bytes.
    ]));

    return this._cd.length;
  }

  async finalise(comment) {

    const cdOffset = this._totalBytes;
    const numEntries = this._cd.length;

    console.log(cdOffset);
    console.log(numEntries);

    // Send all Central Directory entries.

    let cdSize = 0;

    for (let data of this._cd) {
      this._enqueue(data);
      cdSize += data.length;
    }

    // Send "End Of Central Directory".

    if (!comment) {
      comment = '';
    } else if (typeof comment !== 'string') {
      comment = '';
    } else if (comment.length > 65535) {
      comment = comment.substr(0, 65535);
    }

    const numEntriesBytes = numberToBytes(numEntries, 2);
    const cdSizeBytes = numberToBytes(cdSize, 4);
    const cdOffsetBytes = numberToBytes(cdOffset, 4);
    const commentLengthBytes = numberToBytes(comment.length, 2);
    const commentBytes = stringToBytes(comment);

    this._enqueue(new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, // 4 - Signature (always this).
      0x00, 0x00,             // 2 - Disk number of this disk (always 0).
      0x00, 0x00,             // 2 - Disk number of central directory (always 0).
      ...numEntriesBytes,     // 2 - Number of central directory enties on this disk.
      ...numEntriesBytes,     // 2 - Total number of central directory entries.
      ...cdSizeBytes,         // 4 - Size of central directory.
      ...cdOffsetBytes,       // 4 - Offset of start of CD, relative to disk where CD starts.
      ...commentLengthBytes,  // 2 - Length of optional comment.
      ...commentBytes,        // N - Optional comment.
    ]));

    // Close the stream.

    this._close();

  }

}