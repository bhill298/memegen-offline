# Meme Generator
A simple meme generator built using the HTML5 Canvas library Fabric.Js. A fork of [Meme-it](https://github.com/Abd3lwahab/Meme-It).

Favicon image art originally from [@StrayRogue](http://twitter.com/strayrogue).

## Fonts
The fonts have been removed from this repo due to potential copyright issues. To see what fonts are expected, see `server/resources/css/fonts.css` and edit that file if needed. Any downloaded files should be placed in `server/resources/fonts`. If the fonts are installed locally on the user's machine, this will also work.

## Additional Features
This fork adds search, scripts for mass downloading images, some quality of life improvements to the image edit interface, and is designed for offline use unlike the original repo. The search is rudimentary and works by searching each word in the search box individually (space-separated) on the image filenames.

## Simple setup (Ubuntu)
Place images in `server/img/memes/` (delete placeholder image first). Scripts are provided to mass download memes (see below), but expect some manual effort to use those.
```
sudo apt install python3-twisted
python3 -m twisted web --listen tcp:8000 --path=./server
```
Alternatively, install with pip:
```
python3 -m pip install Twisted service-identity
```
This will work by default, but the js is written in a way that expects a query
of the image directory to return a list of image files like an ftp server.
Alternatively, you can use a php script to query the images from the server
(`get_images.php`) if you set the server up to handle php files. To enable
this, set `__use_php = true` in `server/resources/js/load-images.js`. You can
test this with e.g. `php -S localhost:8000`.

## Downloading images
There are two python scripts provided: `download_memes_api.py` and `download_memes.py` (both require python3). The first one uses imgflip's API (https://imgflip.com/api) to get the top 100 most popular memes on their website and download them. This is fast and straightforward to use. `download_memes.py` downloads every meme on imgflip's website by using a headless browser script. This is slow (10s of minutes), hacky, and requires the additional python dependencies of `selenium` and `webdriver-manager` from pip. Additionally, you need chrome installed. Also note that if you use the latter script with a large enough count (`-n`), a lot of duplicate and low quality images will get downloaded that you will likely want to manually clean up.
