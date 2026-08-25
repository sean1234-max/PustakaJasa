// The teacher-facing Reference Sample image box (.ref-sample-img,
// src/index.css) is capped at 280x200 with `object-fit: contain` and no
// stored natural-size column on catalog_reference_images — so the actual
// rendered image rect (what ReferenceImageOverlay needs to position text
// against) has to be computed at runtime from the image's own natural
// size vs. its container's current box, or overlay text lands in the
// wrong spot whenever the image's aspect ratio doesn't exactly fill the
// box (the common case — most reference images are wider than 280:200).
//
// Standard `object-fit: contain` letterbox math: scale the image to fit
// entirely within the container on whichever axis is the tighter
// constraint, then center it on the other axis.
export function computeContainRect(containerW, containerH, naturalW, naturalH) {
  if (!containerW || !containerH || !naturalW || !naturalH) {
    return { x: 0, y: 0, width: containerW || 0, height: containerH || 0 };
  }
  const containerRatio = containerW / containerH;
  const imageRatio = naturalW / naturalH;
  let width, height;
  if (imageRatio > containerRatio) {
    width = containerW;
    height = containerW / imageRatio;
  } else {
    height = containerH;
    width = containerH * imageRatio;
  }
  return { x: (containerW - width) / 2, y: (containerH - height) / 2, width, height };
}
