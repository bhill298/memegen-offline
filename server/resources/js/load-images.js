$(function () {
    var $memesContainer = $('.memes-container')
    var memesTemplate = $('#meme-template').html()

    function addPhoto(meme) {
        $memesContainer.append(Mustache.render(memesTemplate, meme))
    }

    // this requires the server to return a file list when you request a directory
    let url = window.location.href + "img/memes/"
    $.ajax({
        type: 'GET',
        dataType: 'html',
        url: url,
        success: function (response) {
            // scan for any links on the rendered html page (this will get any files, not just images)
            let responses = response.match(/<a href=".*"/gm);
            let imgNames = [];
            for (let i = 0; i < responses.length; i++) {
                let name = responses[i].match(/href="(.*)"/)[1];
                imgNames.push(name);
            }
            imgNames.sort();
            for (let i = 0; i < imgNames.length; i++) {
                let name = imgNames[i];
                // strip extension for the alt text
                addPhoto({name: name.substring(0, name.lastIndexOf(".")) || name,
                    width: 5000, height: 5000, "url": url + name});
            }
            var $grid = reflowGrid();
            $grid.imagesLoaded().progress(function (instance, image) {
                $grid.masonry('layout');
                let img = image.img;
                img.setAttribute("img-height", img.naturalHeight)
                img.setAttribute("img-width", img.naturalWidth)
            });
        },
        error: function () {
            showAlert("An error occurred while loading images, try again later.")
        }
    });
})
