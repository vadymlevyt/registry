// Розкладання документів КС «Ворзель» НАН України по підпапках _Упорядковано.
// Копіює (НЕ переміщує — оригінали лишаються) 140 файлів у вже створені папки.
//
// ЯК ЗАПУСТИТИ:
// 1. Відкрийте https://script.google.com (тим самим акаунтом, де лежать файли).
// 2. «Новий проєкт» -> виділіть увесь зразковий код (Ctrl+A) і видаліть.
// 3. Вставте ВЕСЬ цей файл.
// 4. Збережіть (Ctrl+S). Угорі виберіть функцію organizeVorzel і натисніть «Виконати».
// 5. Перший раз попросить дозвіл на Drive — погодьтеся (Додатково -> Перейти до проєкту -> Дозволити).
// 6. У «Журналі виконання» побачите підсумок: Скопійовано / Помилок.
//
// Запускайте ОДИН раз (повторний запуск зробить ще один комплект копій).

var FOLDERS = {
  '01': '1feJGppeqO5HWSfKM7Mofow91IEiUoZVb', // 01_Судові_справи
  '02': '1uMm1CrmDafqFxoAkMON2QabwHHfxPbSD', // 02_Банкрутство_санація
  '03': '17ESIQbaHw9yD5RTsWM94fEmZlqT0z7Mh', // 03_Корпоративні
  '04': '1S4RqFoXsRKwUFpoIvJy8mYu3z1k3j8Rk', // 04_Майно_активи
  '05': '1ZELwEOuFdyfWNWiLUX-3GvsKbfszvHov', // 05_Листування
  '06': '1daEh9Go5PZJ0yY_JEsJ-qkXvP02Tde-L', // 06_Інше_невизначене
  '07': '1xn9wkZLMoYtIbLZ_CyXeAw6HgvJUuk_f'  // 07_Аналітика_довідки
};

// [ fileId, blockKey ]
var JOBS = [
  // 01_Судові_справи (29)
  ['1WoA0gGbzqEnZmH58qNFqXoQJptgNMn2x','01'],
  ['1xSquWHezKe9j9RPAq9s6jKt-KQkZA_bG','01'],
  ['1Hs1Lrn9h6ag4ZNUjrXdOlKial1hjA6vi','01'],
  ['17lpmrToHkaLOLpczfnKcGFp0IILc_7pt','01'],
  ['1bWZJNufjjUcl0VPUiPpWSaWO3YTRLPV2','01'],
  ['1YJAl5lp5PUlWFNx6gnIk-fNLX0ibWA16','01'],
  ['1Gm2nXYlOZfTqjNcme8HpPism9mP4C8nI','01'],
  ['1Nx3WZ-HiTBF9D7NTrW4YPqQHn1GjySTj','01'],
  ['1zaA9ivf_nxOCep4Dr2plXiLiRxSNg2pu','01'],
  ['1fqww9HtpawHYVFsRB5xPlBM83d4s7enY','01'],
  ['1l7od6QPGCgIQGU_RqP_uahSu82RB8r41','01'],
  ['1qIQWC3QlhB9DSKqRLcFHXzpr8OBkEOdQ','01'],
  ['1D5aP8FaXATa-k7p5zdDx-4PwzLBynHLa','01'],
  ['1olxlLISIVbzLBm1n-rVEqt3FL_tYAm5Z','01'],
  ['1FAjSHfN_fSD9rP1djQ6-vSUn6xamYc7E','01'],
  ['18Ok-7EBzrVczJWIWsOO5wnhn8tLHJiCZ','01'],
  ['1DiKzR7K_1Tq-PVHGf5o9w08pkR4A9yKB','01'],
  ['1dKw20chDqG4HUIip11JYEy_Ibu_QgtLb','01'],
  ['1OIiPb5E1uf6-T8h8gO5AGOwS_CnQEX1_','01'],
  ['16Tiq6PCYsZMYC8FVQFMcy_6lmpgV8dfd','01'],
  ['1Cb2grnhsUSbCXWkVOhWPtKWLLfCeBUsS','01'],
  ['1hAKrCQW8bEk6xVa6Tc_MOhikeBL50f3E','01'],
  ['1A51e-fZ_0RWO-cMA5QrDjG59RZEQLAEO','01'],
  ['18MQuCLptI5qL8Sm-cCnueElCH3dZZ8PB','01'],
  ['1747AZfm1grMDTTAMA9qhVY4_pwnbbr-a','01'],
  ['1vec459q_3q15ovQSugwjyv6cUA8gzi5T','01'],
  ['14CPEF3jwqMUIn9vjEt53gsw9rPGQym-8','01'],
  ['1x0ZOVbPSFWp8Cks_uegolCB7WgqQY1fR','01'],
  ['1Yc3gyW4ucfdNOGHafYxoNddW2X0LosWM','01'],

  // 02_Банкрутство_санація (27)
  ['1AOffFTdxgjRF6WcTnlFzQbZCRIq0ZX_u','02'],
  ['1kfiP7fCHvVsMVRsrHhWOzcWkbeue2gzD','02'],
  ['1ea70RsLBQHDYv_cR1BPOaSSGnjiZNcSq','02'],
  ['13EzKrwmVYn3h1F-XcwFviMGWPLkbcN5n','02'],
  ['1HVRq4ayC1S0YKluSeH2979LEDD2hT5fN','02'],
  ['11xFaRR3c9rYd9KTBuXNWu0AtUYwK0_nY','02'],
  ['1W7Q2j3xrWwU_BB027ycrcUZmohQg06OJ','02'],
  ['18iuYBZb0dUQsLFb9UQAuD62NZJIFFplo','02'],
  ['1YoT99ksFwU8HJNN_SplyLTzNFoorpktd','02'],
  ['1rTx1Ky_YAoQ80lbGRfBcWutYvHYZSUzc','02'],
  ['1igCoovTLjoHj-5OubXTC-SZf2P9HQHmc','02'],
  ['1RzJyKvlwdVO5e62sZu8pYXagsscW6j0w','02'],
  ['1SKMFU_PC21DH_Ou6FoIwR7Vn2vUZA6-T','02'],
  ['1_uBnD_3x6AXPCtN0JlWqMXovMDFv1_t9','02'],
  ['1x-s-YH5CiibA_EGp8RWcxuZoILsPeHrR','02'],
  ['1TM5o-YI83rl39Kz8cUbup96dxH7YZJcz','02'],
  ['13w6EpVdoLukK8fncJqqr6EqBLjgBylvC','02'],
  ['1xNbVfIM3IvIUC506a61BxdtMIJzrPz-4','02'],
  ['1z_uZYMcoEg6e1JBNS8L2BYidtom10lv1','02'],
  ['14GGEPTB3hxnthsnRwcitoBFg1GsLaFew','02'],
  ['1uJcxu8htpsg5QDRrY5U86CWeQuk6TZdz','02'],
  ['1jFhJp5qkw0cVDbVkyCX3H102kj7btWqi','02'],
  ['1O5gM_jH9WwOAv9DiI4ZXTyewHQyxIv5M','02'],
  ['11KoB6UnUF6PP2331r6RPA0nJU7iAbk_A','02'],
  ['1WCs63-LRGL3eMqudLvfi1eJqYq8nuj97','02'],
  ['1jmaxJ-6B-_b02298JydcoC3nDPjW3ZGY','02'],
  ['17yVjDCHTrjJyUn-CSM9CyqTGxw711h0N','02'],

  // 03_Корпоративні (11)
  ['142Q7Yif_bVWsaVxXncLcgcqJJwMvDgje','03'],
  ['1d-jz3EpltlUxcqvoJaHphqdKbZgHOZZC','03'],
  ['1Pvz3-XpJZHqluxCPAl3BpYLZl32sPINB','03'],
  ['1Tb_0hiY9dWcpVfnkYwbphLvzhSP8HOc0','03'],
  ['1vUN-6SSv00kokvrF9uQiX4BkpRx4uwkR','03'],
  ['10rsV64ak74NzhWYrW26UtVYmquwuwFsC','03'],
  ['1DgmxBy0LKEo45ArLnQvYCNBrRLrdz7Tm','03'],
  ['1SAFvFmWOE_o-HP556rqO2awmcruNtojP','03'],
  ['1wA69YKscXq92AMbFjEO5Wv77OGeA_C9_','03'],
  ['1culR8PxKD_cUaMm5rPCnTMWv3Vj34IhO','03'],
  ['1NQg-gqyYV5qhyAUZSNmUCtNeZ-lHZWpB','03'],

  // 04_Майно_активи (3)
  ['1BcEtnUAYYvj6bLxiuwSRq55QnmwI7rUK','04'],
  ['1XRYPps6Cqe81KDXlxyrY4errEMgnC1-o','04'],
  ['1duoHrGUXD_ao6gmyHi608a5GLvcKXkUW','04'],

  // 05_Листування (39)
  ['1jNifve06u6chAXLm_KWOz-yaBWpvePYD','05'],
  ['11STKRieH0Uxdg0hTkWpK6oi0CdIS7qU9','05'],
  ['1fkIKOY728IO7r7auiHLtXMAfScYgwlPz','05'],
  ['10W1cBANo0sp7L4yAVZ0vyMjLQUbS-Z82','05'],
  ['1XAOg5UXpJon2Za3vaa07UcoHRw9f8nvH','05'],
  ['13erf6LETweVveccdZPuyjQt_UF_Xg1xL','05'],
  ['1DsINUfgf_75qvcEo1J3MqZKYkiepW7OF','05'],
  ['1Qnk4TrZzLB34_ZYakWH-iazyl6WuVoj5','05'],
  ['1zBK_Bad_0Lud5kMMj5KpLSjECM2glJED','05'],
  ['1dU-LbYXqDPhSXF3GfL0GYI5QATRIXVad','05'],
  ['1w0oJB1ciUsazNkzdbPxONcP13pU1TbJ6','05'],
  ['1ObqQ1NRyghgOPLSFLc7k9cZJQE3urj3H','05'],
  ['12lNOs1PXsdh9aQ_PFlUKhloXg0XvZepZ','05'],
  ['1_RFqi0G42eYzOCcMwRs4EcwNuS_RYXUh','05'],
  ['1Vzd1bFjz-6iyTN3Mo6bj99b3fRjtfWXa','05'],
  ['1cboQ4oiiyEPn_EI0VphGnypgosDi3I3k','05'],
  ['1tvJTnSkAjLld_jTHDdRntE4Yn1mWoS-P','05'],
  ['1MeTaRwy02xUP4UPry0xI2KyD2PQSB8v8','05'],
  ['15iZNoYBSlTqTLedUuA1YcPWL3FSLsAc9','05'],
  ['1t0zDLweAyUgreN_22AzeHBebBgw_ggv7','05'],
  ['144r275lB2IazYSv1_KtWee0sZWoYKAXQ','05'],
  ['16YmTlZ74d2WT5Q-6qVS6xBLPnAI4AYGI','05'],
  ['1BRQDV2NzRncfv3LGBgn5stMDnfnat71o','05'],
  ['1yywA5SFgm2CiJvDIoUa0fgAp4qMO5iFX','05'],
  ['1mushC_ecwrLH0t1ViwIUg53bhyA96LBG','05'],
  ['1eAy3ujWXMTSZW3i20NL3DAuqhFX5EtYd','05'],
  ['1r5QO1NfAx-e4NSSGmqcKh6fPhPx7i_7p','05'],
  ['1Z4ipJAnEH8g66hoc_NsTRIGZtf3K7--x','05'],
  ['1-3YhqVX-KxGXwZrpWAuwmtslh9li94-P','05'],
  ['1t-4HGADJlKEO8rLp37dPD61PbzuYoZro','05'],
  ['1t5JkGrQO8ldH2lx7SnEoG1u_DS3N5yAY','05'],
  ['1j7dVzwuuQfGtJ8mfB0lbMzKANqaGDrUv','05'],
  ['1d7iRNsKigcSGwj1W6FqeosWcd9-_ywr7','05'],
  ['1LcjRI_5XsQOcvAkrzvQcFBNXzHfQsogA','05'],
  ['1WebY3RWrYiWNAZcxF80ZKFrsR2rKmIX9','05'],
  ['1894ZrQZbJl8qWHouuMHdnSi3AzboKjNC','05'],
  ['1tgqp8AOGxCdMB91mq5-fGgBOj95HFhS5','05'],
  ['1VgA0yjK0Udy09_vMftWQMljvdPIk8Zx8','05'],
  ['12xDXJpwlAiWnnt72StoV8Lkd8gkwepQ9','05'],

  // 06_Інше_невизначене (1)
  ['10ip1UfACs4i9XYgRQNwk2PRNAfWu4bqF','06'],

  // 07_Аналітика_довідки (30)
  ['1p96FA0Ao1xsKsLNfkK3W1CnsWnsNTIP0','07'],
  ['1sUQdqqpQldZxjLaaPwybTrWJOtsCg5Zv','07'],
  ['1_l1S0__QilSOYaRNESWhv6dmF-Mligmo','07'],
  ['1oqEWdymStFQId6NX20ldO1k893NHECF4','07'],
  ['1zImGYVfzvHwKvG2PBwWxc69pdZkwP3CZ','07'],
  ['18tNwSZMXCgHITi2hy9P7LQUC8gemmEgw','07'],
  ['1MEGBMuHpCYANiJStGVRoeV0a020fPRNe','07'],
  ['1P7DwxD5Hylz4FecCjil2xtoc13aTcz3V','07'],
  ['18WPELCy8J4GJJbbRVu19C7krchDMmLPA','07'],
  ['1AKwBgPUYI-_1uJVIqbikBPX1PWVOVuaw','07'],
  ['1Zg6w26ZM_ADwLKWpNT-jMffmeMjTUhbD','07'],
  ['1n4YpjVOOzUQfmZenpEOdpgzC6te2m7BW','07'],
  ['1iSlxLtHSww2VKVfe963zCR8RKQ5bul6I','07'],
  ['143R05DV1DvMidB6fTxehONDg2deIlb_0','07'],
  ['1cARP5D5n0i_JXwZGKP8PtCIK2i9srnPl','07'],
  ['1qoeqj9GjuCg8LSWTHUjtWog0g-I106QI','07'],
  ['1UBCKoNB4_zaVuaRYHveCJ_tlJAPWX5yY','07'],
  ['1XjT55vSSfVS0jqMvT2xL5RfQUdYvDlPM','07'],
  ['1Euo145EAXzTkWfcYR3ijbvayU1Ey7-Az','07'],
  ['1PmEFA2Y__c4Ph9DVZQDGlweFEv4mN7bR','07'],
  ['1QOO7g_-iQiOKbJ5RJDITdOHPaCpsWEO-','07'],
  ['1uy8XeqkZ0eMeuiB2INyyEbmf9WaICWyg','07'],
  ['1MKvyIXZSKdn5-P3FryUGekJFAHvpRjbk','07'],
  ['15f-NvPmHDKlTZMe175jmACeC5FptTe68','07'],
  ['1tCFhBHrkVpwZwP1kFWvITh30X_huuJk-','07'],
  ['1N3nzz-qXqkc4gyiSXszGcju7Ke2C-6DH','07'],
  ['1uFNrzKJG024MuDfZWO_8csG4NysOsLN2','07'],
  ['1DW4dPIjzpBID-f1PEEI86t7vnjw9EahN','07'],
  ['1c1IlKv8IHAPVRZu92c1leXDi4kt97sFT','07'],
  ['1G_6N2vRsSA2DhSQXBkFWuEa4-ZaDCN1c','07']
];

function organizeVorzel() {
  var folderCache = {};
  for (var k in FOLDERS) {
    folderCache[k] = DriveApp.getFolderById(FOLDERS[k]);
  }

  var ok = 0, fail = 0, failed = [];
  for (var i = 0; i < JOBS.length; i++) {
    var fileId = JOBS[i][0];
    var block = JOBS[i][1];
    try {
      var f = DriveApp.getFileById(fileId);
      f.makeCopy(f.getName(), folderCache[block]); // зберігає оригінальну назву
      ok++;
    } catch (e) {
      fail++;
      failed.push(fileId + ' -> ' + block + ' : ' + e);
    }
  }
  Logger.log('Готово. Скопійовано: ' + ok + ' / Помилок: ' + fail + ' (усього ' + JOBS.length + ')');
  if (failed.length) {
    Logger.log('ПОМИЛКИ:\n' + failed.join('\n'));
  }
}
