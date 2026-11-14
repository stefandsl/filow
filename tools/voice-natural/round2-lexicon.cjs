// Experimental fallback only. These spellings need native listening; not shipped.
const words = ['file','save','download','settings','microsoft','powerpoint','pdf','chrome'];
const spellings = {
  it: ['fàil','sèiv','dàunloud','sèttings','Màicrosoft','Pàuerpòint','pi di èf','cròum'],
  ru: ['файл','сэйв','даунлоуд','сэттингз','Майкрософт','Пауэрпойнт','пи ди эф','Хроум'],
  ro: ['fail','seiv','daunloud','setings','Maicrosoft','Pauerpoint','pi di ef','croum'],
};
function respell(text,lang) {
  return text.replace(/[A-Za-z]+/g,w=>spellings[lang]?.[words.indexOf(w.toLowerCase())]??w);
}
module.exports={respell};
