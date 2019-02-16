# zipper

Zips files.

## Usage.

```
const zipper = new Zipper();

zipper.addFile('image.jpg', new Uint8Array([66, 66, 66]));
zipper.addFile('text.txt', 'test file');
zipper.addFile('arrayBuffer.txt', [66, 66, 66, 66, 66]);

const blob = zipper.toBlob('my comments');
const arr = zipper.toUint8Array('my comments');
```
