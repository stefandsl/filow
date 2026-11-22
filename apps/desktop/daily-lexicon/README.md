# Offline verb index

`verbs.json.gz` is a derived index of verb lemmas, grammatical forms and synset memberships. Filow decompresses it locally. This data file is separately licensed from the Filow application. Rebuild with `python scripts/build-daily-lexicon.py INPUT_DIR`. The script verifies the input hashes.

* Save the [Princeton WordNet 3.0 archive](https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/wordnet.zip) as `wordnet.zip`. The included wordnet-license.txt applies to its English synset data.
* Save [Open Multilingual Wordnet 1.4](https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/omw-1.4.zip) as `omw.zip`. Italian synsets derive from MultiWordNet 1.5.0 by Emanuele Pianta, Luisa Bentivogli and Christian Girardi under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
* Save the UniMorph [English](https://raw.githubusercontent.com/unimorph/eng/master/eng) and [Italian](https://raw.githubusercontent.com/unimorph/ita/master/ita) inflection tables as `eng` and `ita`. The UniMorph contributors credit Wikipedia and license these tables under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The derived index is distributed under the same license.
