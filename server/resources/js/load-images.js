var __initDone = false;
var __imgNames = [];
var __$memesContainer = $('.memes-container');
var __memesTemplate = $('#meme-template').html();
var __currentMemeIndex = 0;
var __currentMemeEndIndex = 0;
const __memeStride = 200;
const __meme_url = window.location.href + "img/memes/"

function clearPhotos() {
    $("#prev-next-buttons").hide();
    // check if initialized
    if (!!$('.grid').data('masonry')) {
        $('.grid').masonry('destroy');
        $('.grid-item').remove();
    }
}

function addPhoto(name) {
    // strip extension for the alt text
    let meme = {name: name.substring(0, name.lastIndexOf(".")) || name,
        width: -1, height: -1, url: __meme_url + name};
    __$memesContainer.append(Mustache.render(__memesTemplate, meme));
}

function getCurrentMemeRange() {
    return [__currentMemeIndex, __currentMemeEndIndex];
}

function getMemeStride() {
    return __memeStride;
}

function getImages() {
    return __imgNames;
}

function updatePhotosFromNames(names) {
    clearPhotos();
    for (name of names) {
        addPhoto(name);
    }
    let $grid = reflowGrid();
    $grid.one('layoutComplete', function(){
        // need to remove hidden the first time since that's in the html (other times it does nothing)
        $("#prev-next-buttons").removeAttr("hidden");
        $("#prev-next-buttons").show();
    });
    // use timeout to let the page finish settling before this runs
    if (__currentMemeIndex === 0) {
        $("#prev-meme-page").prop('disabled', true);
    }
    else {
        $("#prev-meme-page").prop('disabled', false);
    }
    if (__currentMemeEndIndex === __imgNames.length - 1) {
        $("#next-meme-page").prop('disabled', true);
    }
    else {
        $("#next-meme-page").prop('disabled', false);
    }
}

function addPhotos(start, count) {
    if (start < 0) {
        start = 0;
    }
    let names = [];
    __currentMemeIndex = start;
    __currentMemeEndIndex = start + count <= __imgNames.length ? start + count - 1 : __imgNames.length - 1;
    for (let i = __currentMemeIndex; i <= __currentMemeEndIndex; i++) {
        names.push(__imgNames[i]);
    }
    updatePhotosFromNames(names);
}

function loadPhotos(start, count=__memeStride) {
    // this requires the server to return a file list when you request a directory
    if (!__initDone) {
        $.ajax({
            type: 'GET',
            dataType: 'html',
            url: __meme_url,
            success: function (response) {
                // check if another request finished while this one was being handled
                if (!__initDone) {
                    // scan for any links on the rendered html page (this will get any files, not just images)
                    let responses = response.match(/<a href=".*"/gm);
                    for (let i = 0; i < responses.length; i++) {
                        let name = responses[i].match(/href="(.*)"/)[1];
                        __imgNames.push(name);
                    }
                    // numeric sort
                    let collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
                    __imgNames.sort(collator.compare);
                    __initDone = true;
                    initDropdown(Math.ceil(__imgNames.length / __memeStride), function(val) {
                        loadPhotos(val * getMemeStride());
                    });
                }
                addPhotos(start, count);
            },
            error: function () {
                showAlert("An error occurred while loading images, try again later.")
            }
        });
    }
    else {
        addPhotos(start, count);
    }
}
