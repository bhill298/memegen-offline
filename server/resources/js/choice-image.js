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
        const fileType = file['type'];

        // Reset file input
        $('#meme-input').val('');

        // Validate this is image
        if (!isImage(fileType)) {
            showAlert('Error! Invalid Image');
            return;
        }

        const reader = new FileReader();
        reader.onload = function () {
            var meme = new Image();
            meme.src = reader.result;
            meme.onload = function () {
                var imgInfo = {
                    url: reader.result,
                    height: meme.height,
                    width: meme.width,
                }
                $('.choice-section').trigger('choice-done', imgInfo);
            }
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
        $('.choice-section').fadeOut('normal', function () {
            $('.edit-section').removeClass('d-none').hide().fadeIn();
            $('.fabric-canvas-wrapper').append(`<canvas id="meme-canvas"></canvas>`);
            // don't think wrapper to perform this check is necessary
            tryProcessMeme(imgInfo);
        });
    });

    // Event: Back button click
    $('.back-btn .btn').on('click', function () {
        $('.edit-section').fadeOut('normal', function () {
            $('.canvas-container').remove();
            $('.choice-section').fadeIn();
            enableTextMethods();
            // force the grid to reflow to push things after the grid to the bottom
            $('.grid').masonry('layout');
        });
    });
});
