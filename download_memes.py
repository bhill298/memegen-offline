import argparse
import base64
import os
import re
import shutil
import time
from collections import OrderedDict

# pip install selenium webdriver-manager
from selenium import webdriver
from selenium.common.exceptions import SessionNotCreatedException, WebDriverException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions
from selenium.webdriver.support.ui import WebDriverWait

parser = argparse.ArgumentParser(description="Download imgflip memes")
parser.add_argument('-n', '--num', default=None, type=int,
    help="Number of memes to download (top n); default is download all.")
parser.add_argument('-s', '--sleep', default=0.2, type=float,
    help="Sleep time between requests (default .2s).")
parser.add_argument('-m', '--max-file-len', default=200, type=int,
    help="Max image file name length (default 200).")
parser.add_argument('-d', '--dir', default=None, help='the path to download to (default to server/img/memes)')
parser.add_argument('-a', '--skip-autoinstall', action="store_true",
    help="Don't try to auto download and update chromedriver, just fail if it isn't already updated.")
parser.add_argument('-p', '--chromedriver-path', default=None,
    help="Provide a path to auto download chromedriver to (default is chromedriver_autoinstaller module directory), ignored with --skip-autoinstall.")
    

def chromedriver_install_to_path(path=None):
    from webdriver_manager.chrome import ChromeDriverManager
    ChromeDriverManager().install()
    # installs the exe directly to the specified directory (if provided) rather than in a version\.exe subdirectory
    # if None, just installs to the chromedriver_autoinstaller module directory
    chromedriver_path = ChromeDriverManager().install()
    if path:
        file_name = os.path.basename(chromedriver_path)
        path_name = os.path.dirname(chromedriver_path)
        shutil.move(chromedriver_path, os.path.join(path_name, "..", file_name))
        os.rmdir(path_name)


def gen_prefix():
    # return a prefix in ascending sort order: a..z za..zz zza..zzz
    first_letter = 'a'
    last_letter = 'z'
    if len(gen_prefix.CUR_PREFIX) == 0 or gen_prefix.CUR_PREFIX[-1] == last_letter:
        gen_prefix.CUR_PREFIX.append(first_letter)
    else:
        gen_prefix.CUR_PREFIX[-1] = chr(ord(gen_prefix.CUR_PREFIX[-1]) + 1)
    return ''.join(gen_prefix.CUR_PREFIX)
gen_prefix.CUR_PREFIX = []


def filter_chars(s):
    return re.sub('[\W_]+', '', s.lower())


def words_to_filename(words, extension, maxlen):
    # return filename from words list e.g. name-of-meme-and-all-unique-words-in-also-called.jpg ; truncate to 200 chars including ext
    MAX_NAME = maxlen - len(extension)
    out_words = [gen_prefix()]
    current_len = 0
    for word in words:
        # include dash that would be added (except to first word)
        current_len += (len(word) + (0 if len(out_words) == 0 else 1))
        if current_len > MAX_NAME:
            break
        out_words.append(word)
    return '-'.join(out_words) + extension.lower()


def execute_script(driver, script_contents, script_args, timeout):
    # in seconds
    driver.set_script_timeout(timeout)
    try:
        res = driver.execute_script(script_contents, *script_args)
        if res is None:
            raise RuntimeError("Script failed to return a value")
        return res
    except TimeoutException:
        print("Error: script timed out")
    except RuntimeError as e:
        print(f"Error: {e}")


def write_file(path, base64data, words, extension, maxlen):
    filepath = os.path.join(path, words_to_filename(words, extension, maxlen))
    with open(filepath, "wb") as f:
        f.write(base64.b64decode(base64data))


args = parser.parse_args()
path = args.dir
if path is None:
    path = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'server/img/memes')
# Need google chrome installed, and webdriver extrected to a dir in system path (https://chromedriver.chromium.org/)
# By default will attempt to automatically install chromedriver
try:
    driver = webdriver.Chrome()
except (SessionNotCreatedException, WebDriverException) as e:
    if not args.skip_autoinstall:
        chromedriver_install_to_path(args.chromedriver_path)
        # try again, then if it fails again give up
        driver = webdriver.Chrome()
    else:
        raise e
driver.minimize_window()
script_contents = ''
with open("download_memes.js", 'r') as f:
    script_contents = f.read()
# max wait time in seconds
wait = WebDriverWait(driver, 10)
next_url = "https://imgflip.com/memetemplates?sort=top-all-time"
memes = []
while next_url is not None:
    time.sleep(args.sleep)
    driver.get(next_url)
    wait.until(expected_conditions.visibility_of_element_located((By.ID, "mt-boxes-wrap")))
    count = args.num - len(memes) if args.num else None
    if count is not None and count <= 0:
        break
    print(f"Parsing memes from url {next_url}")
    res = execute_script(driver, script_contents, [1, count], 60)
    next_url = res[0]
    for meme in res[1:]:
        title, template_url = meme
        print(f"Retrieved meme with url {template_url}")
        words = OrderedDict()
        for word in title.split(" "):
            words[filter_chars(word)] = ""
        memes.append([words, template_url])
for meme in memes:
    words, template_url = meme
    time.sleep(args.sleep)
    driver.get(template_url)
    wait.until(expected_conditions.visibility_of_element_located((By.ID, "mtm-img")))
    print(f"downloading img {template_url}")
    res = execute_script(driver, script_contents, [2], 60)
    b64, new_words, ext = res
    for word in new_words:
        words[filter_chars(word)] = ""
    print(f"writing image")
    write_file(path, b64, words.keys(), ext, args.max_file_len)
print("Cleaning up and exiting...")
driver.quit()
