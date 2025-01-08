# Meme-It
Meme it is a simple meme generator built using HTML5 Canvas library Fabric.Js, and it allows you to manipulate text or images on chosen meme template.

## Additional Features
This fork adds search, scripts for mass downloading images, and is designed for offline use unlike the upstream repo. The search is rudimentary and works by searching each word individually (space-separated) in the search box on the image filenames.

## Simple setup (Ubuntu)
Place images in `server/img/memes/`.
```
sudo apt install python3-twisted
cd server && python3 -m twisted web --listen tcp:8000 --path=.
```

## Downloading images
There are two python scripts provided: `download_memes_api.py` and `download_memes.py` (both require python3). The first one uses imgflip's API (https://imgflip.com/api) to get the top 100 most popular memes on their website and download them. This is fast and straightforward to use. `download_memes.py` downloads every meme on imgflip's website by using a headless browser script. This is slow (10s of minutes), hacky, and requires the additional python dependencies of `selenium` and `webdriver-manager` from pip. Additionally, you need chrome installed. Also note that if you use the latter script with a large enough count (`-n`), a lot of duplicate and low quality images will get downloaded that you will likely want to manually clean up.

## License
[MIT](https://github.com/Abd3lwahab/Meme-It/blob/master/LICENSE)
