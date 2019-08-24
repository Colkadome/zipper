
function downloadZip (event) {

  const zipper = new Zipper();

  zipper.addEntry('test.txt', 'test test');

  const url = URL.createObjectURL(zipper.toBlob('comment'));
  event.target.setAttribute('href', url);
}

function downloadTar (event) {

};

async function downloadStream (event) {
  event.preventDefault();

  // Create zip stream.
  const zipperStream = new ZipperStream();

  // Await zip stream data.
  const fileStream = streamSaver.createWriteStream('filename.zip', {});
  zipperStream.pipeTo(fileStream);

  // Add streams to zipper.
  await zipperStream.addStream('test.jpg', (await fetch('https://i.imgur.com/rVCgFGC.jpg')).body.getReader());
  zipperStream.finalise();
}

window.onload = function () {

  const zipEl = document.getElementById('zip');
  zipEl.addEventListener('click', downloadZip, false);

  const tarEl = document.getElementById('tar');
  tarEl.addEventListener('click', downloadTar, false);

  const streamEl = document.getElementById('stream');
  streamEl.addEventListener('click', downloadStream, false);

};

