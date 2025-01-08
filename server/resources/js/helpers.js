// Update attribute of the current canvas object
function setValue(key, value) {
    if (canvas.getActiveObject() != null) {
        var activeText = canvas.getActiveObject();
        activeText.set(key, value);
        canvas.renderAll();
    }
}

// Return current background color
function getBackgroundColor(color) {
    if ($('#bg-option').hasClass('active')) {
        return color;
    } else {
        return '';
    }
}

function disableTextMethods() {
    $('.text-method').attr('disabled', 'disabled');
    $('#font-family').selectpicker('refresh');
    $('.align').addClass('disabled');
    $.each($('.cp'), function (i, cp) {
        ($(cp).colorpicker('colorpicker')).disable();
    });
}

function enableTextMethods() {
    $('.text-method').attr('disabled', false);
    $('#font-family').selectpicker('refresh');
    $('.align').removeClass('disabled');
    $.each($('.cp'), function (i, cp) {
        ($(cp).colorpicker('colorpicker')).enable();
    });
}

function createShadow(color, width) {
    return `${color} 0px 0px ${width}`;
}

function setBackgroundColor(color) {
    setValue("textBackgroundColor", getBackgroundColor(color));
}

function isImage(fileType) {
    const validImageTypes = ['image/jpeg', 'image/png'];
    if (validImageTypes.includes(fileType)) {
        return true;
    }
    return false;
}

// Generate a random 6-character name
function createImgName() {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < 6; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return `${result}.png`;
}

// Show alert message
function showAlert(message) {
    $('.alert-container')
        .html(`<p class="text-center mb-0"><strong>${message}</strong></p>`)
        .fadeIn('normal', function () {
            setTimeout(function () {
                $('.alert-container').fadeOut('normal', function () {
                    $('.alert-container').html('');
                });
            }, 3000);
        });
}

function reflowGrid() {
    let $grid = $('.grid').masonry({
        itemSelector: '.grid-item',
        percentPosition: true,
        columnWidth: '.grid-sizer',
        transitionDuration: 0
    });
    $grid.imagesLoaded().progress(function (instance, image) {
        $grid.masonry('layout');
        let img = image.img;
        img.setAttribute("img-height", img.naturalHeight);
        img.setAttribute("img-width", img.naturalWidth);
    });
    return $grid;
}

var __searchTimeout = null;
function scheduleMemeSearch(searchBoxContents, timeout=500) {
    // timeout in ms
    if (__searchTimeout !== null) {
        clearTimeout(__searchTimeout);
    }
    __searchTimeout = setTimeout(function() {
        __searchTimeout = null;
        doMemeSearch(searchBoxContents);
    }, timeout);
}

var __lastMemeSearchTerm = "";
var __lastAndSelected = document.getElementById("meme-search-option-and").checked;
function doMemeSearch(searchBoxContents) {
    searchBoxContents = searchBoxContents.trim();
    // otherwise OR
    let andSelected = document.getElementById("meme-search-option-and").checked;
    if (searchBoxContents === __lastMemeSearchTerm && andSelected === __lastAndSelected) {
        // no need to do anything
        return;
    }
    __lastAndSelected = andSelected;
    __lastMemeSearchTerm = searchBoxContents;
    if (searchBoxContents.length === 0) {
        // reset
        loadPhotos(getCurrentMemeRange()[0]);
    }
    else {
        let names = [];
        let terms = searchBoxContents.toLowerCase().split(" ");
        let memeStride = getMemeStride();
        for (name of getImages()) {
            if (names.length >= memeStride) {
                break;
            }
            let match = true;
            for (const term of terms) {
                // filter the image string to search on
                let imgStr = name.toLowerCase();
                // if it starts with a number (used for sorting), ignore it in the search
                let index = imgStr.indexOf("-");
                if (index !== -1 && !isNaN(imgStr.substr(0, index))) {
                    imgStr = imgStr.substr(index + 1);
                }
                if (term.length > 0 && imgStr.includes(term)) {
                    if (!andSelected) {
                        names.push(name);
                        break;
                    }
                }
                else if (andSelected) {
                    match = false;
                    break;
                }
            }
            if (andSelected && match) {
                names.push(name);
            }
        }
        updatePhotosFromNames(names);
    }
}

function initDropdown(num, callback) {
    let $sel = $("#page-dropdown");
    $sel.empty();
    for (let i = 0; i < num; i++) {
        let el = $("<option></option>").val(i).html(i);
        $sel.append(el);
    }
    $sel.selectpicker("refresh");
    $sel.selectpicker("val", 0);
    $sel.change(function() {
        callback($(this).val());
    });
    return $sel;
}

function setDropdown(val) {
    let $sel = $("#page-dropdown");
    $sel.selectpicker("val", val);
}

function canvasVisisble() {
    return document.getElementById("meme-canvas-wrapper").offsetParent !== null;
}
