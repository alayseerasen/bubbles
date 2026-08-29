/* ============================================================
   BUBBLES — ВЫБОР ОБЛАСТИ ИЗОБРАЖЕНИЯ (кроппер)
   ------------------------------------------------------------
   Общий инструмент для аватара, обложки трека (квадрат 1:1) и
   обложки профиля (прямоугольник, широкий баннер). Пользователь
   двигает фото пальцем/мышью и приближает ползунком — выбирает
   ровно ту область, которую хочет видеть в итоге.

   Использование:
     const blob = await openImageCropper(file, { aspect: 1, outputSize: 800 });
     if (blob) { ...загрузить blob... }
   blob === null, если пользователь нажал "Отмена".
   ------------------------------------------------------------ */

let cropperState = null;

function openImageCropper(file, { aspect = 1, outputSize = 800 } = {}) {
    return new Promise((resolve) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            showBubblesModal(`
                <div class="modal-header">
                    <h3>Выбери область</h3>
                    <button class="modal-close-btn" onclick="cancelImageCrop()">✕</button>
                </div>
                <div class="cropper-viewport" id="cropperViewport" style="aspect-ratio:${aspect};">
                    <img id="cropperImage" draggable="false" src="${objectUrl}">
                </div>
                <div class="cropper-controls">
                    <span>🔍</span>
                    <input type="range" id="cropperZoomSlider" min="1" max="3" step="0.01" value="1" oninput="onCropperZoomInput(this.value)">
                </div>
                <p class="muted" style="text-align:center;margin:6px 0 12px;">Потяни, чтобы подвинуть, ползунок — чтобы приблизить</p>
                <button class="primary full" onclick="confirmImageCrop()">✅ Готово</button>
            `);

            // По умолчанию клик мимо модалки просто закрывает её, ничего
            // не резолвя — тогда await openImageCropper(...) в вызывающем
            // коде повис бы навсегда, а созданный object URL никогда не
            // освободился. Клик мимо — это тоже "Отмена".
            const overlay = document.getElementById("bubblesModalOverlay");
            if (overlay) overlay.onclick = (e) => { if (e.target === overlay) cancelImageCrop(); };

            const viewport = document.getElementById("cropperViewport");
            const imgEl = document.getElementById("cropperImage");
            const viewportW = viewport.clientWidth;
            const viewportH = viewport.clientHeight;
            const baseScale = Math.max(viewportW / img.naturalWidth, viewportH / img.naturalHeight);

            cropperState = {
                objectUrl,
                img,
                imgEl,
                viewport,
                viewportW,
                viewportH,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
                baseScale,
                zoom: 1,
                offsetX: 0,
                offsetY: 0,
                dragging: false,
                dragStartX: 0,
                dragStartY: 0,
                dragOffsetX: 0,
                dragOffsetY: 0,
                outputSize,
                aspect,
                resolve
            };

            centerCropperImage();
            renderCropperTransform();
            attachCropperDragHandlers();
        };

        img.onerror = () => { URL.revokeObjectURL(objectUrl); toast("Не удалось открыть изображение."); resolve(null); };
        img.src = objectUrl;
    });
}

function centerCropperImage() {
    const s = cropperState;
    const dispW = s.naturalWidth * s.baseScale * s.zoom;
    const dispH = s.naturalHeight * s.baseScale * s.zoom;
    s.offsetX = (s.viewportW - dispW) / 2;
    s.offsetY = (s.viewportH - dispH) / 2;
}

function clampCropperOffset() {
    const s = cropperState;
    const dispW = s.naturalWidth * s.baseScale * s.zoom;
    const dispH = s.naturalHeight * s.baseScale * s.zoom;
    const minX = s.viewportW - dispW; // самое левое допустимое положение (отрицательное)
    const minY = s.viewportH - dispH;
    s.offsetX = Math.min(0, Math.max(minX, s.offsetX));
    s.offsetY = Math.min(0, Math.max(minY, s.offsetY));
}

function renderCropperTransform() {
    const s = cropperState;
    if (!s) return;
    const dispW = s.naturalWidth * s.baseScale * s.zoom;
    const dispH = s.naturalHeight * s.baseScale * s.zoom;
    s.imgEl.style.width = dispW + "px";
    s.imgEl.style.height = dispH + "px";
    s.imgEl.style.transform = `translate(${s.offsetX}px, ${s.offsetY}px)`;
}

function onCropperZoomInput(value) {
    const s = cropperState;
    if (!s) return;
    s.zoom = parseFloat(value);
    clampCropperOffset();
    renderCropperTransform();
}

function attachCropperDragHandlers() {
    const s = cropperState;
    const el = s.viewport;

    const onPointerDown = (e) => {
        s.dragging = true;
        s.dragStartX = e.clientX;
        s.dragStartY = e.clientY;
        s.dragOffsetX = s.offsetX;
        s.dragOffsetY = s.offsetY;
        el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e) => {
        if (!s.dragging) return;
        s.offsetX = s.dragOffsetX + (e.clientX - s.dragStartX);
        s.offsetY = s.dragOffsetY + (e.clientY - s.dragStartY);
        clampCropperOffset();
        renderCropperTransform();
    };
    const onPointerUp = (e) => {
        s.dragging = false;
        try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    s._cleanupDrag = () => {
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointermove", onPointerMove);
        el.removeEventListener("pointerup", onPointerUp);
        el.removeEventListener("pointercancel", onPointerUp);
    };
}

function confirmImageCrop() {
    const s = cropperState;
    if (!s) return;

    const outputW = s.aspect >= 1 ? s.outputSize : Math.round(s.outputSize * s.aspect);
    const outputH = s.aspect >= 1 ? Math.round(s.outputSize / s.aspect) : s.outputSize;
    const scaleFactor = outputW / s.viewportW;

    const canvas = document.createElement("canvas");
    canvas.width = outputW;
    canvas.height = outputH;
    const ctx = canvas.getContext("2d");

    const dispW = s.naturalWidth * s.baseScale * s.zoom * scaleFactor;
    const dispH = s.naturalHeight * s.baseScale * s.zoom * scaleFactor;
    ctx.drawImage(s.img, s.offsetX * scaleFactor, s.offsetY * scaleFactor, dispW, dispH);

    canvas.toBlob((blob) => {
        finishCropper(blob);
    }, "image/jpeg", 0.88);
}

function cancelImageCrop() {
    finishCropper(null);
}

function finishCropper(result) {
    const s = cropperState;
    if (!s) return;
    if (s._cleanupDrag) s._cleanupDrag();
    URL.revokeObjectURL(s.objectUrl);
    const resolve = s.resolve;
    cropperState = null;
    closeBubblesModal();
    resolve(result);
}
