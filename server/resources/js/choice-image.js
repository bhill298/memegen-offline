$(function () {
    let handlingClick = false;
    // Event: Choice meme from top 100
    $('.memes-container').delegate('img', 'click', function () {
        var $img = $(this);
        if ($img.length === 0 || !$img[0].complete || !$img[0].naturalWidth || handlingClick) {
            // image not loaded or handling another click
            return;
        }
        var imgInfo = {
            url: $img.attr('src'),
            height: $img.attr('img-height'),
            width: $img.attr('img-width'),
            mimeType: $img.attr('src').toLowerCase().endsWith('.gif') ? 'image/gif' : '',
        }
        // need to wait for image to load / don't fire an event while another one is being handled
        if (imgInfo.width === undefined || imgInfo.height === undefined || parseInt(imgInfo.width) <= 0 || parseInt(imgInfo.height) <= 0) {
            // invalid width or height
            showAlert(`Couldn't load image canvas: bad width or height (w=${imgInfo.width} h=${imgInfo.height})`);
            return;
        }
        handlingClick = true;
        $('.choice-section').trigger('choice-done', imgInfo);
    });

    // Event: Upload local image
    $('#meme-input').on('change', function () {
        const file = this.files[0];

        // Reset file input
        $('#meme-input').val('');

        if (!file) {
            return;
        }

        // Validate this is image
        if (!isImage(file.type)) {
            showAlert('Error! Invalid Image');
            return;
        }

        const reader = new FileReader();
        reader.onload = function () {
            var meme = new Image();
            meme.onload = function () {
                var imgInfo = {
                    url: reader.result,
                    height: meme.height,
                    width: meme.width,
                    mimeType: file.type,
                    fileName: file.name,
                    sourceFile: file,
                }
                $('.choice-section').trigger('choice-done', imgInfo);
            }
            meme.onerror = function () {
                showAlert('Error! The selected image could not be decoded.');
            }
            meme.src = reader.result;
        }
        reader.onerror = function () {
            showAlert('Error! The selected image could not be read.');
        }
        reader.onabort = function () {
            showAlert('Image loading was cancelled.');
        }
        reader.readAsDataURL(file);
    });

    function tryProcessMeme(imgInfo) {
        if (canvasVisisble()) {
            processMeme(imgInfo);
            handlingClick = false;
        }
        else {
            setTimeout(tryProcessMeme, 50, imgInfo);
        }
    }

    // Event: Choice was made
    $('.choice-section').on('choice-done', function (e, imgInfo) {
        handlingClick = true;
        prepareGifMemeInfo(imgInfo).then(function (preparedInfo) {
            const sizePlan = preparedInfo.sizePlan || createImageSizePlan(
                preparedInfo.width, preparedInfo.height
            );
            if (sizePlan.error) {
                throw new Error(sizePlan.error);
            }
            preparedInfo.sizePlan = sizePlan;

            $('.choice-section').fadeOut('normal', function () {
                $('.edit-section').removeClass('d-none').hide().fadeIn();
                $('.fabric-canvas-wrapper').append(`<canvas id="meme-canvas"></canvas>`);
                // don't think wrapper to perform this check is necessary
                tryProcessMeme(preparedInfo);
            });
        }).catch(function (error) {
            handlingClick = false;
            showAlert(`Error! ${error.message}`);
        });
    });

    // Event: Back button click
    $('.back-btn .btn').on('click', function () {
        $('.edit-section').fadeOut('normal', function () {
            destroyMemeEditor();
            $('.choice-section').fadeIn();
            enableTextMethods();
            // force the grid to reflow to push things after the grid to the bottom
            $('.grid').masonry('layout');
        });
    });
});
