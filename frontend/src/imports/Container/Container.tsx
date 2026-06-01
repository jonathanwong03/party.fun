function Heading() {
  return (
    <div className="absolute h-[26.992px] left-[23.99px] right-[23.99px] top-[23.99px]" data-name="Heading 3">
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-0 not-italic text-[#f5f5f7] text-[18px] top-[0.5px] whitespace-nowrap">Who’s going?</p>
    </div>
  );
}

function ListItem() {
  return (
    <div className="h-[20px] relative shrink-0 w-full" data-name="List Item">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[20px] left-0 text-[#8a8a99] text-[14px] top-[-0.38px] whitespace-nowrap">50 students have locked in. 350 spots remaining</p>
    </div>
  );
}

function NumberedList() {
  return (
    <div className="absolute content-stretch flex flex-col h-[27px] items-start left-[20.38px] right-[27.61px] top-[123.75px]" data-name="Numbered List">
      <ListItem />
    </div>
  );
}

export default function Container() {
  return (
    <div className="bg-[#14141b] border-[0.625px] border-[rgba(255,255,255,0.08)] border-solid relative rounded-[16px] size-full" data-name="Container">
      <Heading />
      <NumberedList />
      <div className="absolute flex items-center justify-center left-[26.38px] size-[55px] top-[57.75px]">
        <div className="-scale-y-100 flex-none rotate-180">
          <div className="relative size-[55px]">
            <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 55 55">
              <circle cx="27.5" cy="27.5" fill="var(--fill-0, #EC2727)" id="Ellipse 2" r="27.5" />
            </svg>
          </div>
        </div>
      </div>
      <div className="absolute flex items-center justify-center left-[69.38px] size-[55px] top-[57.75px]">
        <div className="-scale-y-100 flex-none rotate-180">
          <div className="relative size-[55px]">
            <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 55 55">
              <circle cx="27.5" cy="27.5" fill="var(--fill-0, #91E357)" id="Ellipse 3" r="27.5" />
            </svg>
          </div>
        </div>
      </div>
      <div className="absolute flex items-center justify-center left-[116.38px] size-[55px] top-[57.75px]">
        <div className="-scale-y-100 flex-none rotate-180">
          <div className="relative size-[55px]">
            <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 55 55">
              <circle cx="27.5" cy="27.5" fill="var(--fill-0, #A1B3E0)" id="Ellipse 4" r="27.5" />
            </svg>
          </div>
        </div>
      </div>
      <div className="absolute flex items-center justify-center left-[162.38px] size-[55px] top-[57.75px]">
        <div className="-scale-y-100 flex-none rotate-180">
          <div className="relative size-[55px]">
            <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 55 55">
              <circle cx="27.5" cy="27.5" fill="var(--fill-0, #DBE12B)" id="Ellipse 5" r="27.5" />
            </svg>
          </div>
        </div>
      </div>
      <div className="absolute flex items-center justify-center left-[206.38px] size-[55px] top-[57.75px]">
        <div className="-scale-y-100 flex-none rotate-180">
          <div className="relative size-[55px]">
            <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 55 55">
              <circle cx="27.5" cy="27.5" fill="var(--fill-0, #30B2EA)" id="Ellipse 6" r="27.5" />
            </svg>
          </div>
        </div>
      </div>
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-[40.38px] not-italic text-[36px] text-white top-[69.75px] whitespace-nowrap">A</p>
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-[84.38px] not-italic text-[36px] text-white top-[71.75px] whitespace-nowrap">B</p>
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-[129.38px] not-italic text-[36px] text-white top-[71.75px] whitespace-nowrap">C</p>
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-[176.38px] not-italic text-[36px] text-white top-[69.75px] whitespace-nowrap">D</p>
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-[222.38px] not-italic text-[36px] text-white top-[71.75px] whitespace-nowrap">E</p>
    </div>
  );
}