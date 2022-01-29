

const notes = document.querySelector('.notes');
const result = document.querySelector('.result');
const resultParas = document.querySelectorAll('.resultParas');
let form = document.getElementById('form');

const submitData = document.getElementById('submitButton');
submitData.addEventListener('click', compoundInterest);

const submitPeriod = document.getElementById('newPeriod');
submitPeriod.addEventListener('click', newPeriod);

var annualAddition = true;
document.getElementById("radialAnnual").checked = true;

var periods = 1;


function annualAd(ann) {
    annualAddition = ann;

    if (annualAddition){
        formLabel = "Annual addition:"
    } else {
        formLabel = "Monthly addition:"
    }
    for (let i = 1; i <= periods; i++) {
        form["addition_"+i].labels[0].innerHTML = formLabel
    }
}


function newPeriodDiv(p) {
var newDiv = `
<!-- PERIOD ${p}-->
    <div class="period_${p}">
        <div class="md:flex md:items-center">
            <div class="md:w-1/3"></div>
            <div class="md:w-2/3">
                <p class="block uppercase tracking-wide text-gray-900 text-m font-bold mb-2">
                    Period ${p}
                </p>
            </div>
        </div>

        <!-- ANNUAL ADDITION -->
        <div class="md:flex md:items-center mb-6">
            <div class="md:w-1/3">
                <label for="addition_${p}" class="block text-gray-700 font-bold md:text-right mb-1 md:mb-0 pr-4">
                    Annual addition
                </label>
            </div>
            <div class="w-2/3 md:w-2/3 lg:w-1/3">
                <input type="text" id="addition_${p}"
                    class="bg-gray-200 appearance-none border-2 border-gray-200 rounded w-full py-2 px-4 text-gray-700 leading-tight focus:outline-none focus:bg-white focus:border-orange-500">
            </div>
        </div>

        <!-- NUMBER OF YEARS -->
        <div class="md:flex md:items-center mb-6">
            <div class="md:w-1/3">
                <label for="years_${p}" class="block text-gray-700 font-bold md:text-right mb-1 md:mb-0 pr-4">
                    Number of years
                </label>
            </div>
            <div class="w-2/3 md:w-2/3 lg:w-1/3">
                <input type="text" id="years_${p}"
                    class="bg-gray-200 appearance-none border-2 border-gray-200 rounded w-full py-2 px-4 text-gray-700 leading-tight focus:outline-none focus:bg-white focus:border-orange-500">
            </div>
        </div>

        <!-- INTEREST RATE -->
        <div class="md:flex md:items-center mb-6">
            <div class="md:w-1/3">
                <label for="interest_${p}" class="block text-gray-700 font-bold md:text-right mb-1 md:mb-0 pr-4">
                    Interest rate
                </label>
            </div>
            <div class="w-2/3 md:w-2/3 lg:w-1/3">
                <input type="text" id="interest_${p}"
                    class="bg-gray-200 appearance-none border-2 border-gray-200 rounded w-full py-2 px-4 text-gray-700 leading-tight focus:outline-none focus:bg-white focus:border-orange-500">
            </div>
        </div>

        <!-- PERIOD RESULT -->
        <div id="divResult_${p}" class="flex md:w-full items-center mb-5">
            <div class="md:w-1/4"></div>
            <div class="md:w-3/4">
                <p class="block text-gray-900 font-bold md:text-middle mb-1 md:mb-0 pr-4" id="result_${p}"></p>
            </div>
        </div>
    </div>     `

    return newDiv
}


function newPeriod() {
    periods++; 
    const newDiv = document.createElement("div");
    newDiv.className = 'period_'+periods

    newDiv.innerHTML = newPeriodDiv(periods)

    let sB = document.getElementById("globalResults")
    form.insertBefore(newDiv, sB)

    if (periods>10) {
        var nP = document.getElementById("newPeriod")
        nP.remove();
    }

    document.getElementById("nPeriods").innerHTML = "Number of periods: " + periods;
}


function compoundInterest() {
    let P = Number(form.initialFunds_1.value);
    let total_invested = 0;
    for (let i = 1; i <= periods; i++) {

        // FV =	P*z^Y + c(z + z^2 + . . . + z^Y)
        // where P is the starting principal, r is the annual interest rate, 
        // Y is the number of years invested, and n is the number of compounding
        // periods per year. FV is the future value, meaning the amount the 
        // principal grows to after Y years. 
        // c is the anual contribution
        // z = 1+r
        let r = Number(form["interest_"+i].value) / 100;
        let n = 1;
        let Y = Number(form["years_"+i].value);
        let c = Number(form["addition_"+i].value)

        const z = 1 + r;

        if (!annualAddition){
            c = c*12;
        }

        total_invested += c * Y;
        let sum = 0;

        sum = (z ** (Y + 1) - z) / (z - 1);

        FV = P * z ** Y + c * sum;

        P = FV

        let partialResult = document.getElementById('result_'+i);
        partialResult.textContent = 'Future Value = ' + addSpaces(FV.toFixed(2));

    } 

    // TOTAL INVESTED
    let totInvestedP = document.getElementById('gR_totInv');
    totInvestedP.textContent = 'Total invested = ' + addSpaces(total_invested.toFixed(2));
    
    // NET RESULT
    let netBenefitP = document.getElementById('gR_netBen');
    netBenefitP.textContent = 'Net benefit = ' + addSpaces((FV - total_invested).toFixed(2));

    let globalResults = document.getElementById('gR_totInv');



    return false;
}


function addSpaces(nStr)
{
    nStr += '';
    x = nStr.split('.');
    x1 = x[0];
    x2 = x.length > 1 ? '.' + x[1] : '';
    var rgx = /(\d+)(\d{3})/;
    while (rgx.test(x1)) {
        x1 = x1.replace(rgx, '$1' + ' ' + '$2');
    }
    return x1 + x2;
}